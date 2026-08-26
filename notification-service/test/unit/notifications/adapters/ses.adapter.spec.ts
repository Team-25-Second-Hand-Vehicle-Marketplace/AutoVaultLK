import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SesAdapter, SesUnavailableError } from '../../../../src/modules/notifications/adapters/ses.adapter';

function config(fromEmail = ''): ConfigService {
  const values: Record<string, string> = { SES_FROM_EMAIL: fromEmail };
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
});
