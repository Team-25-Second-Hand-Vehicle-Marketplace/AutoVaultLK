import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationNotifications1735000012000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notification.notifications (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        type       varchar(40) NOT NULL
                   CHECK (type IN ('UPLOAD_COMPLETED','UPLOAD_FAILED','LISTING_APPROVED',
                                   'LISTING_REJECTED','DEALER_VERIFIED','WELCOME','PASSWORD_RESET')),
        subject    varchar(255) NOT NULL,
        message    text NOT NULL,
        payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
        status     varchar(20) NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','SENT','FAILED','BOUNCED')),
        sent_at    timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_notifications_user_id ON notification.notifications (user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_notifications_status ON notification.notifications (status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE notification.notifications`);
  }
}
