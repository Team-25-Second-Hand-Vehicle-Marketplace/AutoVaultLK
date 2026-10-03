import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { EXPIRY_REMINDER_DAYS } from '../listing-expiry';
import {
  ListingNotificationEvent,
  NotificationInternalClient,
} from '../clients/notification-internal.client';

/** Reminders sent in parallel per chunk, so notification-service is not flooded. */
export const REMINDER_CHUNK_SIZE = 20;

type ExpiringRow = {
  id: string;
  dealer_id: string;
  upload_job_id: string | null;
  make: string;
  model: string;
  expires_at: Date;
};

@Injectable()
export class ListingReminderService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationInternalClient,
  ) {}

  /**
   * One reminder per bulk batch that is expiring, and one per single listing.
   * A batch of a thousand listings is still one email. The idempotency key holds
   * the expiry date, so a listing renewed and expiring again later gets a new
   * reminder, while a retry of the same run never double-sends.
   */
  async sendExpiryReminders(now: Date) {
    const rows: ExpiringRow[] = await this.dataSource.query(
      `SELECT id, dealer_id, upload_job_id, make, model, expires_at
         FROM marketplace.vehicles
        WHERE status = 'LIVE'
          AND expires_at > $1
          AND expires_at <= $1::timestamptz + make_interval(days => $2)`,
      [now, EXPIRY_REMINDER_DAYS],
    );

    const events = this.toEvents(rows);
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < events.length; i += REMINDER_CHUNK_SIZE) {
      const chunk = events.slice(i, i + REMINDER_CHUNK_SIZE);
      const results = await Promise.all(chunk.map((event) => this.notifications.emit(event)));
      sent += results.filter(Boolean).length;
      failed += results.filter((ok) => !ok).length;
    }

    return { batches: events.filter((e) => e.type === 'LISTING_EXPIRING_BATCH').length, singles: events.filter((e) => e.type === 'LISTING_EXPIRING').length, sent, failed };
  }

  private toEvents(rows: ExpiringRow[]): ListingNotificationEvent[] {
    const batches = new Map<string, { dealerId: string; uploadJobId: string; expiresOn: string; count: number }>();
    const events: ListingNotificationEvent[] = [];

    for (const row of rows) {
      const expiresOn = new Date(row.expires_at).toISOString().slice(0, 10);

      if (row.upload_job_id) {
        const groupKey = `${row.upload_job_id}:${expiresOn}`;
        const group = batches.get(groupKey);
        if (group) {
          group.count += 1;
        } else {
          batches.set(groupKey, { dealerId: row.dealer_id, uploadJobId: row.upload_job_id, expiresOn, count: 1 });
        }
        continue;
      }

      events.push({
        type: 'LISTING_EXPIRING',
        userId: row.dealer_id,
        idempotencyKey: `expiry-listing:${row.id}:${expiresOn}`,
        payload: { listingTitle: `${row.make} ${row.model}`, expiresOn },
      });
    }

    for (const [groupKey, group] of batches) {
      events.push({
        type: 'LISTING_EXPIRING_BATCH',
        userId: group.dealerId,
        idempotencyKey: `expiry-batch:${groupKey}`,
        payload: { count: group.count, expiresOn: group.expiresOn },
      });
    }

    return events;
  }
}
