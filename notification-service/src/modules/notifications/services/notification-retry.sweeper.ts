import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsRepository } from '../repositories/notifications.repository';
import { NotificationEventHandler } from './notification-event.handler';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 20;

/**
 * FR-53: drives the retries that NotificationEventHandler schedules.
 *
 * Without this, `next_attempt_at` would be a column nothing ever reads — the
 * handler would record that a row deserves another attempt and no attempt
 * would follow.
 *
 * A self-managed timer rather than @nestjs/schedule: the service already runs
 * its own polling loop in SqsConsumer, and one more dependency to fire a
 * 30-second tick is not worth the addition. The loop follows that consumer's
 * shape — a `running` flag flipped on destroy, so shutdown is not left waiting
 * on an interval.
 *
 * Set NOTIFICATION_RETRY_ENABLED=false to disable the sweep (tests, or a single
 * instance among several where only one should sweep).
 */
@Injectable()
export class NotificationRetrySweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationRetrySweeper.name);

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Guards against a slow sweep overlapping the next tick. */
  private sweeping = false;

  constructor(
    private readonly config: ConfigService,
    private readonly repository: NotificationsRepository,
    private readonly handler: NotificationEventHandler,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NOTIFICATION_RETRY_ENABLED') === 'false') {
      this.logger.log('Notification retry sweeper disabled by configuration');
      return;
    }

    const interval = Number(
      this.config.get('NOTIFICATION_RETRY_INTERVAL_MS') ?? DEFAULT_INTERVAL_MS,
    );

    this.running = true;
    this.timer = setInterval(() => void this.sweep(), interval);
    // The tick should not hold the process open on its own; a service with
    // nothing else to do should still be able to exit.
    this.timer.unref?.();

    this.logger.log(`Notification retry sweeper started (every ${interval}ms)`);
  }

  onModuleDestroy(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Claims the due rows and attempts each one. Public so tests can drive a
   * single pass without waiting on the timer.
   */
  async sweep(): Promise<number> {
    if (this.sweeping || !this.running) return 0;
    this.sweeping = true;

    try {
      const batchSize = Number(
        this.config.get('NOTIFICATION_RETRY_BATCH_SIZE') ?? DEFAULT_BATCH_SIZE,
      );

      const due = await this.repository.claimDueRetries(batchSize, new Date());
      if (due.length === 0) return 0;

      this.logger.log(`Retrying ${due.length} notification(s)`);

      let delivered = 0;
      for (const row of due) {
        try {
          const result = await this.handler.deliver(row);
          if (result.status === 'SENT') delivered += 1;
        } catch (err) {
          // deliver() has already recorded the outcome on the row. One bad
          // notification must not abandon the rest of the batch.
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Retry of ${row.id} failed: ${message}`);
        }
      }

      return delivered;
    } catch (err) {
      // A sweep that throws must not kill the interval — the next tick should
      // still run, since the usual cause is the database being briefly away.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Notification retry sweep failed: ${message}`);
      return 0;
    } finally {
      this.sweeping = false;
    }
  }
}
