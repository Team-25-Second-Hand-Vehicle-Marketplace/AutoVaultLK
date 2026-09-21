import { NotificationRetrySweeper } from '../../../../src/modules/notifications/services/notification-retry.sweeper';
import type { Notification } from '../../../../src/infrastructure/database/entities/notification.entity';

function due(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    userId: 'u1',
    type: 'UPLOAD_COMPLETED',
    subject: 'Your upload finished',
    message: 'Hi there',
    payload: {},
    status: 'PENDING',
    sentAt: null,
    createdAt: new Date(),
    idempotencyKey: 'upload-1',
    attemptCount: 1,
    nextAttemptAt: new Date(Date.now() - 1000),
    lastError: 'SES HTTP 503',
    ...overrides,
  };
}

describe('NotificationRetrySweeper', () => {
  function makeSweeper(config: Record<string, string> = {}) {
    const repository = {
      claimDueRetries: jest.fn((): Promise<Notification[]> =>
        Promise.resolve([]),
      ),
    };
    const handler = {
      deliver: jest.fn((row: Notification): Promise<Notification> =>
        Promise.resolve({ ...row, status: 'SENT' }),
      ),
    };
    const configService = { get: (key: string) => config[key] };

    const sweeper = new NotificationRetrySweeper(
      configService as never,
      repository as never,
      handler as never,
    );

    return { sweeper, repository, handler };
  }

  /** The timer is not under test; start() only flips the running flag. */
  function started(config: Record<string, string> = {}) {
    const made = makeSweeper(config);
    made.sweeper.onModuleInit();
    return made;
  }

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('lifecycle', () => {
    it('does not start when disabled by configuration', async () => {
      const { sweeper, repository } = makeSweeper({
        NOTIFICATION_RETRY_ENABLED: 'false',
      });

      sweeper.onModuleInit();
      await sweeper.sweep();

      expect(repository.claimDueRetries).not.toHaveBeenCalled();
    });

    it('stops sweeping once destroyed', async () => {
      const { sweeper, repository } = started();

      sweeper.onModuleDestroy();
      await sweeper.sweep();

      expect(repository.claimDueRetries).not.toHaveBeenCalled();
    });
  });

  describe('sweep', () => {
    it('claims a batch and delivers each row', async () => {
      const { sweeper, repository, handler } = started();
      repository.claimDueRetries.mockResolvedValue([
        due({ id: 'a' }),
        due({ id: 'b' }),
      ]);

      const delivered = await sweeper.sweep();

      expect(handler.deliver).toHaveBeenCalledTimes(2);
      expect(delivered).toBe(2);
    });

    it('does nothing when no rows are due', async () => {
      const { sweeper, handler } = started();

      const delivered = await sweeper.sweep();

      expect(handler.deliver).not.toHaveBeenCalled();
      expect(delivered).toBe(0);
    });

    it('claims with the configured batch size', async () => {
      const { sweeper, repository } = started({
        NOTIFICATION_RETRY_BATCH_SIZE: '5',
      });

      await sweeper.sweep();

      expect(repository.claimDueRetries).toHaveBeenCalledWith(
        5,
        expect.any(Date),
      );
    });

    // One undeliverable notification must not abandon the rest of the batch —
    // deliver() has already recorded its outcome on the row.
    it('continues the batch when one row throws', async () => {
      const { sweeper, repository, handler } = started();
      repository.claimDueRetries.mockResolvedValue([
        due({ id: 'a' }),
        due({ id: 'b' }),
        due({ id: 'c' }),
      ]);
      handler.deliver.mockImplementation((row: Notification) => {
        if (row.id === 'b')
          return Promise.reject(new Error('recipient vanished'));
        return Promise.resolve({ ...row, status: 'SENT' });
      });

      const delivered = await sweeper.sweep();

      expect(handler.deliver).toHaveBeenCalledTimes(3);
      expect(delivered).toBe(2);
    });

    it('counts only the rows that actually sent', async () => {
      const { sweeper, repository, handler } = started();
      repository.claimDueRetries.mockResolvedValue([
        due({ id: 'a' }),
        due({ id: 'b' }),
      ]);
      handler.deliver.mockImplementation((row: Notification) => {
        // A row that failed transiently again stays PENDING.
        const status = row.id === 'a' ? 'SENT' : ('PENDING' as const);
        return Promise.resolve({ ...row, status });
      });

      await expect(sweeper.sweep()).resolves.toBe(1);
    });

    // The usual cause is the database being briefly away; killing the interval
    // would mean retries never resume.
    it('survives a failure to claim', async () => {
      const { sweeper, repository } = started();
      repository.claimDueRetries.mockRejectedValue(
        new Error('connection terminated'),
      );

      await expect(sweeper.sweep()).resolves.toBe(0);
    });

    // A sweep slower than the tick interval would otherwise overlap itself and
    // claim a second batch while the first is still in flight.
    it('does not run two sweeps concurrently', async () => {
      const { sweeper, repository } = started();
      let release: (() => void) | undefined;
      repository.claimDueRetries.mockImplementation(
        () =>
          new Promise<Notification[]>((resolve) => {
            release = () => resolve([]);
          }),
      );

      const first = sweeper.sweep();
      const second = await sweeper.sweep();

      expect(second).toBe(0);
      expect(repository.claimDueRetries).toHaveBeenCalledTimes(1);

      release?.();
      await first;
    });
  });
});
