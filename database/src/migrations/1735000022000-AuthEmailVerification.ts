import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthEmailVerification1735000022000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.users
        ADD COLUMN email_verified_at timestamptz
    `);

    await queryRunner.query(`
      UPDATE auth.users
      SET email_verified_at = created_at
      WHERE email_verified_at IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE auth.email_verification_tokens (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        token_hash varchar(255) NOT NULL UNIQUE,
        expires_at timestamptz  NOT NULL,
        used_at    timestamptz,
        created_at timestamptz  NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX idx_email_verification_tokens_user_id ON auth.email_verification_tokens (user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_email_verification_tokens_expires_at ON auth.email_verification_tokens (expires_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE auth.email_verification_tokens`);
    await queryRunner.query(`
      ALTER TABLE auth.users
        DROP COLUMN email_verified_at
    `);
  }
}
