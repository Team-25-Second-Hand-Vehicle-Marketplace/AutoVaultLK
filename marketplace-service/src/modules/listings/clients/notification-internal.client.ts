import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ListingNotificationEvent = {
  type: 'LISTING_EXPIRING_BATCH' | 'LISTING_EXPIRING';
  userId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

/**
 * Posts one event to notification-service. Never throws: a reminder that fails
 * is counted, and the next daily run tries again because the idempotency key
 * is only recorded when the notification is actually accepted.
 */
@Injectable()
export class NotificationInternalClient {
  private readonly logger = new Logger(NotificationInternalClient.name);

  constructor(private readonly config: ConfigService) {}

  async emit(event: ListingNotificationEvent): Promise<boolean> {
    const base = (
      this.config.get<string>('NOTIFICATION_INTERNAL_URL') ?? 'http://localhost:3005'
    ).replace(/\/$/, '');
    const key = (this.config.get<string>('INTERNAL_SERVICE_KEY') ?? '').trim();

    if (!key) {
      this.logger.warn('Listing reminder skipped: INTERNAL_SERVICE_KEY is not set');
      return false;
    }

    try {
      const res = await fetch(`${base}/notifications/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': key,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        this.logger.warn(`Listing reminder ${event.idempotencyKey} rejected (${res.status})`);
        return false;
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Listing reminder ${event.idempotencyKey} failed: ${message}`);
      return false;
    }
  }
}
