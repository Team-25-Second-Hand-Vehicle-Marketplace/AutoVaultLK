import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Notification } from '../../../infrastructure/database/entities/notification.entity';
import type { CreateNotificationEventDto } from '../dto/create-notification-event.dto';
import { SesAdapter, SesUnavailableError } from '../adapters/ses.adapter';
import { EmailTemplateService } from './email-template.service';
import { NotificationsRepository } from '../repositories/notifications.repository';

@Injectable()
export class NotificationEventHandler {
  private readonly logger = new Logger(NotificationEventHandler.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly templates: EmailTemplateService,
    private readonly ses: SesAdapter,
  ) {}

  async handle(dto: CreateNotificationEventDto): Promise<Notification> {
    const existing = await this.repository.findByIdempotencyKey(
      dto.idempotencyKey,
    );
    if (existing?.status === 'SENT') {
      return existing;
    }

    const row = existing ?? (await this.insertPending(dto));
    return this.deliver(row);
  }

  private async insertPending(
    dto: CreateNotificationEventDto,
  ): Promise<Notification> {
    const user = await this.repository.findUser(dto.userId);
    if (!user) {
      throw new NotFoundException(`Recipient ${dto.userId} was not found`);
    }

    const payload = dto.payload ?? {};
    const rendered = this.templates.render(dto.type, user.name, payload);

    try {
      return await this.repository.createPending({
        userId: dto.userId,
        type: dto.type,
        subject: rendered.subject,
        message: rendered.message,
        payload,
        idempotencyKey: dto.idempotencyKey,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.repository.findByIdempotencyKey(
          dto.idempotencyKey,
        );
        if (raced) return raced;
      }
      throw err;
    }
  }

  /**
   * Attempts delivery once and records the outcome.
   *
   * Called both on intake and from the retry sweeper, so it must be safe to
   * run against a row that has already been attempted several times.
   */
  async deliver(row: Notification): Promise<Notification> {
    // Re-checked rather than assumed: the sweeper may be working from a row it
    // read moments ago, and intake may have delivered it in between.
    if (row.status === 'SENT') return row;

    const user = await this.repository.findUser(row.userId);
    if (!user) {
      // A missing recipient will not become present on a retry.
      await this.repository.markFailed(
        row.id,
        `Recipient ${row.userId} was not found`,
      );
      throw new NotFoundException(`Recipient ${row.userId} was not found`);
    }

    const attempt = row.attemptCount + 1;

    try {
      await this.ses.send(user.email, row.subject, row.message);
      await this.repository.markSent(row.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (err instanceof SesUnavailableError) {
        await this.recordTransientFailure(row, attempt, message);
        // Swallowed deliberately: the event is scheduled, not lost. Rethrowing
        // would make the SQS consumer redeliver the message as well, and the
        // row would then be attempted from two directions at once.
        return (await this.repository.findById(row.id)) ?? row;
      }

      // Anything else is a defect or a malformed recipient - retrying it would
      // burn the attempt budget on an outcome that cannot change.
      await this.repository.markFailed(row.id, message);
      this.logger.warn(
        `SES delivery failed permanently for ${row.id}: ${message}`,
      );
      throw err;
    }

    return (await this.repository.findById(row.id)) ?? row;
  }

  private async recordTransientFailure(
    row: Notification,
    attempt: number,
    message: string,
  ): Promise<void> {
    if (attempt >= MAX_DELIVERY_ATTEMPTS) {
      await this.repository.markFailed(row.id, message);
      this.logger.error(
        `SES delivery for ${row.id} gave up after ${attempt} attempts: ${message}`,
      );
      return;
    }

    const nextAttemptAt = new Date(Date.now() + backoffMs(attempt));
    await this.repository.scheduleRetry(
      row.id,
      attempt,
      nextAttemptAt,
      message,
    );
    this.logger.warn(
      `SES delivery failed for ${row.id} (attempt ${attempt}/${MAX_DELIVERY_ATTEMPTS}); ` +
        `retrying at ${nextAttemptAt.toISOString()}: ${message}`,
    );
  }
}

/**
 * Attempts before a row is given up on. Five attempts across the backoff below
 * span roughly half an hour, which covers an ordinary SES incident without
 * leaving a genuinely undeliverable row cycling forever.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

export function backoffMs(attempt: number): number {
  const exponential = Math.min(
    BASE_BACKOFF_MS * 2 ** (attempt - 1),
    MAX_BACKOFF_MS,
  );
  const jitter = Math.random() * exponential * 0.2;
  return Math.round(exponential + jitter);
}

function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const pg = err as QueryFailedError & {
    code?: string;
    driverError?: { code?: string };
  };
  return pg.driverError?.code === '23505' || pg.code === '23505';
}
