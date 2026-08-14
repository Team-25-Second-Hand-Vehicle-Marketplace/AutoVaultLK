import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type NotificationEventType =
  | 'UPLOAD_COMPLETED'
  | 'UPLOAD_FAILED'
  | 'DEALER_VERIFIED'
  | 'DEALER_REJECTED';

@Injectable()
export class NotificationInternalClient {
  private readonly logger = new Logger(NotificationInternalClient.name);

  constructor(private readonly config: ConfigService) {}

  async emit(event: {
    type: NotificationEventType;
    userId: string;
    idempotencyKey: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    const base = (
      this.config.get<string>('NOTIFICATION_INTERNAL_URL') ?? 'http://localhost:3005'
    ).replace(/\/$/, '');
    const key = this.config.getOrThrow<string>('INTERNAL_SERVICE_KEY');

    let res: Response;
    try {
      res = await fetch(`${base}/notifications/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': key,
        },
        body: JSON.stringify(event),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Notification service unreachable: ${message}`);
      return;
    }

    if (!res.ok) {
      this.logger.warn(`Notification event failed (${res.status}): ${await res.text()}`);
    }
  }
}
