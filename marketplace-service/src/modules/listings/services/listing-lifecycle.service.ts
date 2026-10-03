import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ListingReminderService } from './listing-reminder.service';

/** Rows touched per statement, so a large backlog never holds locks for long. */
export const LIFECYCLE_BATCH_SIZE = 500;

@Injectable()
export class ListingLifecycleService {
  private readonly logger = new Logger(ListingLifecycleService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly reminders: ListingReminderService,
  ) {}

  /**
   * The daily run: archive listings past their expiry, purge old snapshots,
   * then send the renewal reminders for listings expiring within five days.
   */
  async runDailyJobs(now: Date) {
    const archived = await this.archiveExpired(now);
    const purged = await this.purgeSnapshots(now);
    const reminders = await this.reminders.sendExpiryReminders(now);

    this.logger.log(
      `Listing lifecycle: archived ${archived}, purged ${purged} snapshot(s), reminders sent ${reminders.sent} of ${reminders.sent + reminders.failed}`,
    );
    return { archived, purged, reminders };
  }

  /** Archives LIVE listings whose term has ended, in batches. */
  async archiveExpired(now: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const rows: unknown[] = await this.dataSource.query(
        `WITH due AS (
           SELECT id FROM marketplace.vehicles
           WHERE status = 'LIVE' AND expires_at < $1
           ORDER BY expires_at
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         UPDATE marketplace.vehicles v
         SET status = 'ARCHIVED', updated_at = $1
         FROM due
         WHERE v.id = due.id
         RETURNING v.id`,
        [now, LIFECYCLE_BATCH_SIZE],
      );
      total += rows.length;
      if (rows.length < LIFECYCLE_BATCH_SIZE) return total;
    }
  }

  /** Deletes deleted-listing snapshots past their 30-day retention, in batches. */
  async purgeSnapshots(now: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const rows: unknown[] = await this.dataSource.query(
        `WITH due AS (
           SELECT id FROM marketplace.deleted_listing_snapshots
           WHERE purge_after < $1
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         DELETE FROM marketplace.deleted_listing_snapshots s
         USING due
         WHERE s.id = due.id
         RETURNING s.id`,
        [now, LIFECYCLE_BATCH_SIZE],
      );
      total += rows.length;
      if (rows.length < LIFECYCLE_BATCH_SIZE) return total;
    }
  }
}
