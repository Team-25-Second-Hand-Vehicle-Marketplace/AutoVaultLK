import { NotificationsRepository } from '../../../../src/modules/notifications/repositories/notifications.repository';
import { Notification } from '../../../../src/infrastructure/database/entities/notification.entity';

/**
 * The query builder is stubbed, so what these assert is the *shape* of the
 * claim — above all that it locks with SKIP LOCKED. That is the property which
 * keeps two replicas from claiming, and then sending, the same notification.
 */
describe('NotificationsRepository', () => {
  const qb = {
    setLock: jest.fn(),
    setOnLocked: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    take: jest.fn(),
    getMany: jest.fn(),
  };

  const manager = {
    createQueryBuilder: jest.fn(() => qb),
    update: jest.fn(),
  };

  const notifications = {
    update: jest.fn(),
    manager: {
      transaction: jest.fn(
        async (run: (m: typeof manager) => Promise<unknown>) => run(manager),
      ),
    },
  };

  let repository: NotificationsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of [
      'setLock',
      'setOnLocked',
      'where',
      'andWhere',
      'orderBy',
      'take',
    ]) {
      (qb as unknown as Record<string, jest.Mock>)[key].mockReturnValue(qb);
    }
    qb.getMany.mockResolvedValue([]);

    repository = new NotificationsRepository(
      notifications as never,
      {} as never,
    );
  });

  describe('claimDueRetries', () => {
    const now = new Date('2026-09-20T10:00:00.000Z');

    it('locks the claimed rows and skips ones another sweeper holds', async () => {
      await repository.claimDueRetries(20, now);

      expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(qb.setOnLocked).toHaveBeenCalledWith('skip_locked');
    });

    it('claims only PENDING rows whose attempt is due', async () => {
      await repository.claimDueRetries(20, now);

      expect(qb.where).toHaveBeenCalledWith('n.status = :status', {
        status: 'PENDING',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('n.next_attempt_at IS NOT NULL');
      expect(qb.andWhere).toHaveBeenCalledWith('n.next_attempt_at <= :now', {
        now,
      });
    });

    it('takes the oldest due rows first', async () => {
      await repository.claimDueRetries(20, now);

      expect(qb.orderBy).toHaveBeenCalledWith('n.next_attempt_at', 'ASC');
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    // Clearing next_attempt_at inside the transaction is what makes the claim
    // stick: a crash after this point leaves the row for a later sweep rather
    // than letting this one pick it up twice.
    it('marks the claimed rows so a second sweep does not re-take them', async () => {
      qb.getMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      await repository.claimDueRetries(20, now);

      expect(manager.update).toHaveBeenCalledWith(Notification, ['a', 'b'], {
        nextAttemptAt: null,
      });
    });

    it('does not issue an update when nothing is due', async () => {
      await repository.claimDueRetries(20, now);

      expect(manager.update).not.toHaveBeenCalled();
    });

    it('runs the claim in one transaction', async () => {
      await repository.claimDueRetries(20, now);

      expect(notifications.manager.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('markSent', () => {
    // A sent row must leave the retry index, or the sweep keeps reconsidering
    // a notification that is already delivered.
    it('clears the retry schedule', async () => {
      await repository.markSent('n1');

      expect(notifications.update).toHaveBeenCalledWith(
        'n1',
        expect.objectContaining({ status: 'SENT', nextAttemptAt: null }),
      );
    });
  });

  describe('markFailed', () => {
    it('clears the retry schedule so the row is terminal', async () => {
      await repository.markFailed('n1', 'SES HTTP 503');

      expect(notifications.update).toHaveBeenCalledWith(
        'n1',
        expect.objectContaining({
          status: 'FAILED',
          nextAttemptAt: null,
          lastError: 'SES HTTP 503',
        }),
      );
    });

    // last_error is varchar(500); an unclamped SDK message would throw on
    // write and lose the failure reason entirely.
    it('clamps an over-long error to the column width', async () => {
      await repository.markFailed('n1', 'x'.repeat(900));

      const [, patch] = notifications.update.mock.calls[0] as [
        string,
        { lastError: string },
      ];
      expect(patch.lastError).toHaveLength(500);
      expect(patch.lastError.endsWith('...')).toBe(true);
    });

    it('leaves the existing reason alone when none is given', async () => {
      await repository.markFailed('n1');

      const [, patch] = notifications.update.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(patch).not.toHaveProperty('lastError');
    });
  });

  describe('scheduleRetry', () => {
    it('keeps the row PENDING with its next attempt recorded', async () => {
      const nextAttemptAt = new Date('2026-09-20T10:01:00.000Z');

      await repository.scheduleRetry('n1', 2, nextAttemptAt, 'SES HTTP 503');

      expect(notifications.update).toHaveBeenCalledWith('n1', {
        status: 'PENDING',
        attemptCount: 2,
        nextAttemptAt,
        lastError: 'SES HTTP 503',
      });
    });
  });
});
