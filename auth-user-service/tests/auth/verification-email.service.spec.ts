import { ConfigService } from '@nestjs/config';
import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { VerificationEmailService } from '../../src/modules/auth/services/verification-email.service';

const sendMock = jest.fn();

jest.mock('@aws-sdk/client-sesv2', () => {
  const actual = jest.requireActual('@aws-sdk/client-sesv2');
  return {
    ...actual,
    SESv2Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  };
});

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

function makeService(values: Record<string, string | undefined>) {
  const config = {
    get: jest.fn((key: string) => values[key]),
  };
  return new VerificationEmailService(config as unknown as ConfigService);
}

describe('VerificationEmailService', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  it('sends nothing and reports false when SES_FROM_EMAIL is unset', async () => {
    const service = makeService({});

    await expect(service.send('a@test.com', 'tok')).resolves.toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(service.isConfigured()).toBe(false);
  });

  it('sends a message to the recipient with a frontend verification link', async () => {
    const service = makeService({
      SES_FROM_EMAIL: 'no-reply@example.com',
      FRONTEND_URL: 'https://app.example.com/',
    });

    await expect(service.send('a@test.com', 'a b/c')).resolves.toBe(true);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as SendEmailCommand;
    expect(command.input.FromEmailAddress).toBe('no-reply@example.com');
    expect(command.input.Destination?.ToAddresses).toEqual(['a@test.com']);
    // Trailing slash on FRONTEND_URL is trimmed and the token is URL-encoded.
    const text = command.input.Content?.Simple?.Body?.Text?.Data;
    expect(text).toContain(
      'https://app.example.com/verify-email?token=a%20b%2Fc',
    );
  });

  describe('SMTP transport (SMTP_HOST set)', () => {
    const smtp = {
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'sender@gmail.com',
      SMTP_PASS: 'app-password',
      FRONTEND_URL: 'https://app.example.com',
    };

    beforeEach(() => {
      mockSendMail.mockReset();
      mockSendMail.mockResolvedValue({});
    });

    it('is configured by SMTP_HOST alone and sends via SMTP, not SES', async () => {
      const service = makeService(smtp);

      expect(service.isConfigured()).toBe(true);
      await expect(service.send('a@test.com', 'tok')).resolves.toBe(true);

      expect(sendMock).not.toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'sender@gmail.com',
          to: 'a@test.com',
          text: expect.stringContaining('https://app.example.com/verify-email?token=tok'),
        }),
      );
    });

    it('uses SMTP_FROM as the from address when provided', async () => {
      const service = makeService({ ...smtp, SMTP_FROM: 'AutoVault <no-reply@rashmip.me>' });

      await service.send('a@test.com', 'tok');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'AutoVault <no-reply@rashmip.me>' }),
      );
    });

    it('returns false instead of throwing when SMTP fails', async () => {
      mockSendMail.mockRejectedValue(new Error('535 bad credentials'));
      const service = makeService(smtp);

      await expect(service.send('a@test.com', 'tok')).resolves.toBe(false);
    });
  });

  it('returns false instead of throwing when SES fails', async () => {
    sendMock.mockRejectedValue(new Error('MessageRejected'));
    const service = makeService({ SES_FROM_EMAIL: 'no-reply@example.com' });

    await expect(service.send('a@test.com', 'tok')).resolves.toBe(false);
  });
});
