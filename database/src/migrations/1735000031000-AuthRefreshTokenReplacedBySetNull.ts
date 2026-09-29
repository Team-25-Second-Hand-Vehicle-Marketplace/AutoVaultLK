import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * refresh_tokens.replaced_by_id was added by AuthRefreshTokenFamilies with a
 * bare REFERENCES clause, defaulting to ON DELETE NO ACTION. The
 * RefreshToken entity has always declared this relation with
 * `onDelete: 'SET NULL'` — matching every other nullable, non-owning FK in
 * this table (auth-user-service/src/infrastructure/database/entities/refresh-token.entity.ts)
 * — so deleting a token that a later rotation has replaced was rejected by
 * the database instead of nulling the reference the way the application
 * code assumes. This migration brings the constraint in line with the
 * entity it was always meant to match.
 */
export class AuthRefreshTokenReplacedBySetNull1735000031000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.refresh_tokens
        DROP CONSTRAINT IF EXISTS refresh_tokens_replaced_by_id_fkey
    `);
    await queryRunner.query(`
      ALTER TABLE auth.refresh_tokens
        ADD CONSTRAINT refresh_tokens_replaced_by_id_fkey
        FOREIGN KEY (replaced_by_id) REFERENCES auth.refresh_tokens(id)
        ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.refresh_tokens
        DROP CONSTRAINT IF EXISTS refresh_tokens_replaced_by_id_fkey
    `);
    await queryRunner.query(`
      ALTER TABLE auth.refresh_tokens
        ADD CONSTRAINT refresh_tokens_replaced_by_id_fkey
        FOREIGN KEY (replaced_by_id) REFERENCES auth.refresh_tokens(id)
    `);
  }
}
