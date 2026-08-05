import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthRefreshTokens1735000004000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE auth.refresh_tokens (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        token_hash varchar(255) NOT NULL UNIQUE,
        expires_at timestamptz  NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_refresh_tokens_user_id ON auth.refresh_tokens (user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_refresh_tokens_expires_at ON auth.refresh_tokens (expires_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE auth.refresh_tokens`);
  }
}
