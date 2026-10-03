import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the two renewal reminder types. A bulk batch nearing expiry gets one
 * email for the whole batch; a single listing gets its own email.
 */
export class NotificationListingExpiring1735000034000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notification.notifications
        DROP CONSTRAINT notifications_type_check
    `);
    await queryRunner.query(`
      ALTER TABLE notification.notifications
        ADD CONSTRAINT notifications_type_check CHECK (type IN (
          'UPLOAD_COMPLETED','UPLOAD_FAILED','LISTING_APPROVED','LISTING_REJECTED',
          'LISTING_EXPIRING_BATCH','LISTING_EXPIRING',
          'DEALER_VERIFIED','DEALER_REJECTED','WELCOME','PASSWORD_RESET'
        ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notification.notifications
        DROP CONSTRAINT notifications_type_check
    `);
    await queryRunner.query(`
      ALTER TABLE notification.notifications
        ADD CONSTRAINT notifications_type_check CHECK (type IN (
          'UPLOAD_COMPLETED','UPLOAD_FAILED','LISTING_APPROVED','LISTING_REJECTED',
          'DEALER_VERIFIED','DEALER_REJECTED','WELCOME','PASSWORD_RESET'
        ))
    `);
  }
}
