import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Notification } from '../../../infrastructure/database/entities/notification.entity';
import type { CreateNotificationEventDto } from '../dto/create-notification-event.dto';
import { SesAdapter, SesUnavailableError } from '../adapters/ses.adapter';
import { EmailTemplateService } from './email-template.service';
import { NotificationsRepository } from '../repositories/notifications.repository';

/**
 * SAD 5.2.5 NotificationEventHandler: persist, send, record delivery.
 * FR-53: a key that already SENT is a no-op (no second SES call).
 */
@Injectable()
export class NotificationEventHandler {
  private readonly logger = new Logger(NotificationEventHandler.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly templates: EmailTemplateService,
    private readonly ses: SesAdapter,
  ) {}

  async handle(dto: CreateNotificationEventDto): Promise<Notification> {
    const existing = await this.repository.findByIdempotencyKey(dto.idempotencyKey);
    if (existing?.status === 'SENT') {
      return existing;
    }

    const row = existing ?? (await this.insertPending(dto));
    return this.deliver(row);
  }

  private async insertPending(dto: CreateNotificationEventDto): Promise<Notification> {
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
        const raced = await this.repository.findByIdempotencyKey(dto.idempotencyKey);
        if (raced) return raced;
      }
      throw err;
    }
  }

  private async deliver(row: Notification): Promise<Notification> {
    if (row.status === 'SENT') return row;

    const user = await this.repository.findUser(row.userId);
    if (!user) {
      await this.repository.markFailed(row.id);
      throw new NotFoundException(`Recipient ${row.userId} was not found`);
    }

    try {
      await this.ses.send(user.email, row.subject, row.message);
      await this.repository.markSent(row.id);
    } catch (err) {
      await this.repository.markFailed(row.id);
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`SES delivery failed for ${row.id}: ${message}`);
      if (!(err instanceof SesUnavailableError)) throw err;
    }

    return (await this.repository.findById(row.id)) ?? row;
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const pg = err as QueryFailedError & { code?: string; driverError?: { code?: string } };
  return pg.driverError?.code === '23505' || pg.code === '23505';
}
