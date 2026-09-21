import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FR-53: retry on transient SES failures, without duplicate-sending one that
 * already succeeded.
 *
 * The idempotency half landed in migration 24000 (the unique idempotency_key).
 * The retry half had nowhere to live: a transient failure marked the row FAILED
 * and nothing ever looked at it again, so a five-minute SES outage silently
 * dropped every notification raised during it.
 *
 * Retry state lives on the row rather than in the SQS message's visibility
 * timeout because FR-52 asks for the delivery status of each notification to be
 * *recorded*. State in the queue is invisible to the dealer-facing and admin
 * views, and does not survive a queue purge or a redrive.
 *
 * next_attempt_at is NULL for a row that is not waiting to be retried — a SENT
 * row, or one that exhausted its attempts. The partial index covers only the
 * due-and-waiting rows the sweep actually claims, so it stays small however
 * large the table grows.
 */
export class NotificationRetryState1735000028000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notification.notifications
        ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
        ADD COLUMN next_attempt_at timestamptz NULL,
        ADD COLUMN last_error varchar(500) NULL
    `);

    // The sweep's claim query: PENDING rows whose next attempt is due.
    await queryRunner.query(`
      CREATE INDEX notifications_retry_due_idx
        ON notification.notifications (next_attempt_at)
        WHERE status = 'PENDING' AND next_attempt_at IS NOT NULL
    `);

    // Rows that failed before this migration were terminal by accident, not by
    // decision — nothing could ever retry them. Hand them back to the sweep,
    // which is safe because delivery is guarded by the idempotency key and a
    // SENT row is never re-sent.
    await queryRunner.query(`
      UPDATE notification.notifications
         SET status = 'PENDING',
             next_attempt_at = now()
       WHERE status = 'FAILED'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS notification.notifications_retry_due_idx
    `);

    // A row still waiting on a retry has no representation in the old schema;
    // FAILED is the closest truth, and matches how such a row was recorded
    // before the retry columns existed.
    await queryRunner.query(`
      UPDATE notification.notifications
         SET status = 'FAILED'
       WHERE status = 'PENDING' AND next_attempt_at IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE notification.notifications
        DROP COLUMN IF EXISTS last_error,
        DROP COLUMN IF EXISTS next_attempt_at,
        DROP COLUMN IF EXISTS attempt_count
    `);
  }
}
