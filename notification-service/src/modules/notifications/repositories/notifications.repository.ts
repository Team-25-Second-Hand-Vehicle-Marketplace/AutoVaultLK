import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../../infrastructure/database/entities/notification.entity';
import { AuthUserView } from '../../../infrastructure/database/entities/auth-user.view-entity';

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(AuthUserView)
    private readonly users: Repository<AuthUserView>,
  ) {}

  findByIdempotencyKey(key: string) {
    return this.notifications.findOne({ where: { idempotencyKey: key } });
  }

  findUser(userId: string) {
    return this.users.findOne({ where: { id: userId } });
  }

  createPending(data: {
    userId: string;
    type: Notification['type'];
    subject: string;
    message: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    return this.notifications.save(
      this.notifications.create({
        ...data,
        status: 'PENDING',
      }),
    );
  }

  markSent(id: string) {
    return this.notifications.update(id, {
      status: 'SENT',
      sentAt: new Date(),
      // A sent row is not waiting on anything; clearing this keeps it out of
      // the retry index and out of the sweep's claim.
      nextAttemptAt: null,
      lastError: null,
    });
  }

  markFailed(id: string, lastError?: string) {
    return this.notifications.update(id, {
      status: 'FAILED',
      nextAttemptAt: null,
      ...(lastError === undefined ? {} : { lastError: clampError(lastError) }),
    });
  }

  /**
   * Records a transient failure and schedules the next attempt. FR-53: the row
   * stays PENDING, because it has not failed — it has not finished.
   */
  scheduleRetry(
    id: string,
    attemptCount: number,
    nextAttemptAt: Date,
    lastError: string,
  ) {
    return this.notifications.update(id, {
      status: 'PENDING',
      attemptCount,
      nextAttemptAt,
      lastError: clampError(lastError),
    });
  }

  /**
   * Claims up to `limit` notifications whose retry is due, and returns them.
   *
   * **FOR UPDATE SKIP LOCKED is what makes this safe under more than one
   * replica.** docker-compose can run several notification-service instances
   * and each sweeps on its own timer; without SKIP LOCKED two of them select
   * the same row and both send it, which is precisely the duplicate delivery
   * FR-53 forbids. SKIP LOCKED makes the second sweeper step over rows the
   * first is already holding rather than block on them.
   *
   * The claim marks rows by clearing next_attempt_at inside the same
   * transaction, so a row is claimed exactly once even if delivery afterwards
   * crashes the process — it then waits for the next sweep rather than being
   * picked up twice in this one.
   */
  async claimDueRetries(limit: number, now: Date): Promise<Notification[]> {
    return this.notifications.manager.transaction(async (manager) => {
      const rows = await manager
        .createQueryBuilder(Notification, 'n')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('n.status = :status', { status: 'PENDING' })
        .andWhere('n.next_attempt_at IS NOT NULL')
        .andWhere('n.next_attempt_at <= :now', { now })
        .orderBy('n.next_attempt_at', 'ASC')
        .take(limit)
        .getMany();

      if (rows.length === 0) return [];

      await manager.update(
        Notification,
        rows.map((row) => row.id),
        { nextAttemptAt: null },
      );

      return rows;
    });
  }

  findById(id: string) {
    return this.notifications.findOne({ where: { id } });
  }
}

/** last_error is varchar(500); an SDK error message can run far longer. */
function clampError(message: string): string {
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}
