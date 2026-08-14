import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FR-53: unique idempotency_key so a retried event cannot send twice.
 * SRS Appendix A includes dealer_rejected; the original CHECK did not.
 */
export class NotificationIdempotencyAndDealerRejected1735000024000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notification.notifications
        ADD COLUMN idempotency_key varchar(128) UNIQUE
    `);

    await queryRunner.query(`
      ALTER TABLE notification.notifications
        DROP CONSTRAINT IF EXISTS notifications_type_check
    `);
    await queryRunner.query(`
      ALTER TABLE notification.notifications
        ADD CONSTRAINT notifications_type_check CHECK (type IN (
          'UPLOAD_COMPLETED','UPLOAD_FAILED','LISTING_APPROVED','LISTING_REJECTED',
          'DEALER_VERIFIED','DEALER_REJECTED','WELCOME','PASSWORD_RESET'
        ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notification.notifications
        DROP CONSTRAINT IF EXISTS notifications_type_check
    `);
    await queryRunner.query(`
      ALTER TABLE notification.notifications
        ADD CONSTRAINT notifications_type_check CHECK (type IN (
          'UPLOAD_COMPLETED','UPLOAD_FAILED','LISTING_APPROVED','LISTING_REJECTED',
          'DEALER_VERIFIED','WELCOME','PASSWORD_RESET'
        ))
    `);
    await queryRunner.query(`
      ALTER TABLE notification.notifications
        DROP COLUMN IF EXISTS idempotency_key
    `);
  }
}
