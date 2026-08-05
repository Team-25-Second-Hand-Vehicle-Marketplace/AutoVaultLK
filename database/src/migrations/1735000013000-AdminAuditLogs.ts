import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminAuditLogs1735000013000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE admin.audit_logs (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        -- SET NULL not CASCADE: audit history must survive user deletion
        actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
        action      varchar(100) NOT NULL,
        entity_type varchar(100) NOT NULL,
        entity_id   uuid,
        changes     jsonb NOT NULL DEFAULT '{}'::jsonb,
        ip_address  inet,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_actor_id ON admin.audit_logs (actor_id)`);
    await queryRunner.query(
      `CREATE INDEX idx_audit_logs_entity ON admin.audit_logs (entity_type, entity_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_audit_logs_created_at ON admin.audit_logs (created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE admin.audit_logs`);
  }
}
