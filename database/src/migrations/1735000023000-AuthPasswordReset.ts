import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthPasswordReset1735000023000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE auth.password_reset_tokens (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        token_hash varchar(255) NOT NULL UNIQUE,
        expires_at timestamptz  NOT NULL,
        used_at    timestamptz,
        created_at timestamptz  NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX idx_password_reset_tokens_user_id ON auth.password_reset_tokens (user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_password_reset_tokens_expires_at ON auth.password_reset_tokens (expires_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE auth.password_history (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        password_hash varchar(255) NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX idx_password_history_user_created ON auth.password_history (user_id, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE auth.password_history`);
    await queryRunner.query(`DROP TABLE auth.password_reset_tokens`);
  }
}
