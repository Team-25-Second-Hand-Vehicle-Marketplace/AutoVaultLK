import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

import { createTransport } from 'nodemailer';
import { SesAdapter, SesUnavailableError } from '../../../../src/modules/notifications/adapters/ses.adapter';

function config(fromEmail = '', extra: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = { SES_FROM_EMAIL: fromEmail, ...extra };
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

describe('SesAdapter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('logs and succeeds when SES_FROM_EMAIL is empty', async () => {
    const adapter = new SesAdapter(config(''));
    const once = jest.spyOn(adapter as never, 'once' as never);
    await expect(adapter.send('amal@example.com', 'Hi', 'Body')).resolves.toBeUndefined();
    expect(once).not.toHaveBeenCalled();
  });

  it('retries once on a 5xx SesUnavailableError then succeeds', async () => {
    jest.useFakeTimers();
    const adapter = new SesAdapter(config('noreply@autovault.lk'));
    const once = jest
      .spyOn(adapter as unknown as { once: SesAdapter['send'] }, 'once')
      .mockRejectedValueOnce(new SesUnavailableError('SES HTTP 503', 503))
      .mockResolvedValueOnce(undefined);

    const pending = adapter.send('amal@example.com', 'Hi', 'Body');
    await jest.advanceTimersByTimeAsync(250);
    await pending;

    expect(once).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx SesUnavailableError', async () => {
    const adapter = new SesAdapter(config('noreply@autovault.lk'));
    jest
      .spyOn(adapter as unknown as { once: SesAdapter['send'] }, 'once')
      .mockRejectedValue(new SesUnavailableError('SES HTTP 400', 400));

    await expect(adapter.send('amal@example.com', 'Hi', 'Body')).rejects.toThrow(SesUnavailableError);
    expect(
      (adapter as unknown as { once: { mock: { calls: unknown[] } } }).once.mock.calls,
    ).toHaveLength(1);
  });
  describe('SMTP transport (SMTP_HOST set)', () => {
    const smtp = {
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '587',
      SMTP_USER: 'sender@gmail.com',
      SMTP_PASS: 'app-password',
    };

    beforeEach(() => {
      mockSendMail.mockReset();
      // restoreAllMocks() in the outer afterEach also clears this factory.
      (createTransport as jest.Mock).mockReturnValue({ sendMail: mockSendMail });
    });

    it('is configured by SMTP_HOST alone and sends via SMTP, not SES', async () => {
      mockSendMail.mockResolvedValue({});
      const adapter = new SesAdapter(config('', smtp));
      const ses = jest.spyOn(adapter as never, 'viaSes' as never);

      expect(adapter.isConfigured()).toBe(true);
      await adapter.send('amal@example.com', 'Hi', 'Body');

      expect(ses).not.toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalledWith({
        from: 'sender@gmail.com',
        to: 'amal@example.com',
        subject: 'Hi',
        text: 'Body',
      });
    });

    it('prefers SMTP_FROM, then SES_FROM_EMAIL, as the from address', async () => {
      mockSendMail.mockResolvedValue({});
      const adapter = new SesAdapter(config('ses@autovault.lk', { ...smtp, SMTP_FROM: 'AutoVault <no-reply@rashmip.me>' }));

      await adapter.send('amal@example.com', 'Hi', 'Body');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'AutoVault <no-reply@rashmip.me>' }),
      );
    });

    it('treats an SMTP 4xx reply as transient and retries', async () => {
      jest.useFakeTimers();
      mockSendMail
        .mockRejectedValueOnce(Object.assign(new Error('try again'), { responseCode: 451 }))
        .mockResolvedValueOnce({});
      const adapter = new SesAdapter(config('', smtp));

      const pending = adapter.send('amal@example.com', 'Hi', 'Body');
      await jest.advanceTimersByTimeAsync(250);
      await pending;

      expect(mockSendMail).toHaveBeenCalledTimes(2);
    });

    it('treats an SMTP 5xx reply (e.g. bad auth) as permanent and does not retry', async () => {
      mockSendMail.mockRejectedValue(
        Object.assign(new Error('535 bad credentials'), { responseCode: 535 }),
      );
      const adapter = new SesAdapter(config('', smtp));

      await expect(adapter.send('amal@example.com', 'Hi', 'Body')).rejects.toThrow(SesUnavailableError);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it('retries a connection-level failure (no SMTP reply)', async () => {
      jest.useFakeTimers();
      mockSendMail
        .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
        .mockResolvedValueOnce({});
      const adapter = new SesAdapter(config('', smtp));

      const pending = adapter.send('amal@example.com', 'Hi', 'Body');
      await jest.advanceTimersByTimeAsync(250);
      await pending;

      expect(mockSendMail).toHaveBeenCalledTimes(2);
    });
  });
});
