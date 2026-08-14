import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthRefreshTokenFamilies1735000020000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.refresh_tokens
        ADD COLUMN family_id uuid NOT NULL DEFAULT gen_random_uuid(),
        ADD COLUMN replaced_by_id uuid REFERENCES auth.refresh_tokens(id),
        ADD COLUMN user_agent varchar(512),
        ADD COLUMN ip_address varchar(45),
        ADD COLUMN device_label varchar(100),
        ADD COLUMN last_used_at timestamptz
    `);

    await queryRunner.query(
      `CREATE INDEX idx_refresh_tokens_family_id ON auth.refresh_tokens (family_id)`,
    );
    await queryRunner.query(`
      CREATE INDEX idx_refresh_tokens_active_user
        ON auth.refresh_tokens (user_id, created_at)
        WHERE revoked_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX auth.idx_refresh_tokens_active_user`);
    await queryRunner.query(`DROP INDEX auth.idx_refresh_tokens_family_id`);
    await queryRunner.query(`
      ALTER TABLE auth.refresh_tokens
        DROP COLUMN last_used_at,
        DROP COLUMN device_label,
        DROP COLUMN ip_address,
        DROP COLUMN user_agent,
        DROP COLUMN replaced_by_id,
        DROP COLUMN family_id
    `);
  }
}
