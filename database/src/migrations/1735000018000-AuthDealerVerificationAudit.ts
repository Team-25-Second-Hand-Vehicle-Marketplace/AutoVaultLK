import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FR-02.2: record which administrator approved or rejected dealer
 * verification and when the decision was made.
 */
export class AuthDealerVerificationAudit1735000018000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.dealer_profiles
        ADD COLUMN IF NOT EXISTS verified_by uuid
          REFERENCES auth.users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS verified_at timestamptz
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_dealer_profiles_verified_by
      ON auth.dealer_profiles (verified_by)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_dealer_profiles_verified_by`,
    );
    await queryRunner.query(`
      ALTER TABLE auth.dealer_profiles
        DROP COLUMN IF EXISTS verified_by,
        DROP COLUMN IF EXISTS verified_at
    `);
  }
}
