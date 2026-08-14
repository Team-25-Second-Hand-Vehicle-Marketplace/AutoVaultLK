import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthAbuseProtection1735000021000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.users
        ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0,
        ADD COLUMN locked_until timestamptz
    `);

    await queryRunner.query(`
      CREATE TABLE auth.security_events (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type     varchar(50)  NOT NULL,
        email          varchar(255),
        user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
        ip_address     varchar(45),
        user_agent     varchar(512),
        success        boolean      NOT NULL DEFAULT false,
        failure_reason varchar(100),
        created_at     timestamptz  NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX idx_security_events_type_created ON auth.security_events (event_type, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_security_events_email_created ON auth.security_events (email, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_security_events_ip_created ON auth.security_events (ip_address, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE auth.security_events`);
    await queryRunner.query(`
      ALTER TABLE auth.users
        DROP COLUMN locked_until,
        DROP COLUMN failed_login_attempts
    `);
  }
}
