import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationInternalClient } from '../../../../src/admin/clients/notification-internal.client';

function config(): ConfigService {
  return {
    get: (key: string) =>
      key === 'NOTIFICATION_INTERNAL_URL' ? 'http://notify:3005/' : undefined,
    getOrThrow: (key: string) => {
      if (key === 'INTERNAL_SERVICE_KEY') return 'internal-service-key';
      throw new Error(`Missing ${key}`);
    },
  } as ConfigService;
}

describe('NotificationInternalClient', () => {
  const client = new NotificationInternalClient(config());
  const event = {
    type: 'DEALER_VERIFIED' as const,
    userId: 'dealer-1',
    idempotencyKey: 'dealer.verified:dealer-1',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POSTs /notifications/events', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    } as Response);

    await client.emit(event);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://notify:3005/notifications/events',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not throw when the notification service is unreachable', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(client.emit(event)).resolves.toBeUndefined();
  });

  it('does not throw when the notification service returns an error status', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    } as Response);
    await expect(client.emit(event)).resolves.toBeUndefined();
  });
});
