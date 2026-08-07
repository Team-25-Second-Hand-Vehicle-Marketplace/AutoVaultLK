import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extends the original dealer profile table to match the auth service entity.
 * Existing dealer profiles remain valid and receive safe development defaults
 * for the newly required fields.
 */
export class AuthDealerProfileDetails1735000015000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE auth.dealer_profiles_dealer_type_enum AS ENUM ('individual', 'business');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE TYPE auth.dealer_profiles_verification_status_enum AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE auth.dealer_profiles
        ADD COLUMN IF NOT EXISTS dealer_type auth.dealer_profiles_dealer_type_enum
          NOT NULL DEFAULT 'individual',
        ADD COLUMN IF NOT EXISTS business_registration_number varchar(500)
          NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS business_address varchar(500)
          NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS city varchar(100)
          NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS verification_documents jsonb
          NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS verification_status auth.dealer_profiles_verification_status_enum
          NOT NULL DEFAULT 'PENDING'
    `);

    await queryRunner.query(`
      UPDATE auth.dealer_profiles
      SET verification_status = CASE is_verified
        WHEN 'VERIFIED' THEN 'VERIFIED'::auth.dealer_profiles_verification_status_enum
        WHEN 'REJECTED' THEN 'REJECTED'::auth.dealer_profiles_verification_status_enum
        ELSE 'PENDING'::auth.dealer_profiles_verification_status_enum
      END
      WHERE is_verified IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE auth.dealer_profiles
        DROP COLUMN IF EXISTS is_verified
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_dealer_profiles_verification_status
      ON auth.dealer_profiles (verification_status)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.dealer_profiles
        ADD COLUMN IF NOT EXISTS is_verified varchar(20)
          NOT NULL DEFAULT 'PENDING'
          CHECK (is_verified IN ('PENDING', 'VERIFIED', 'REJECTED'))
    `);

    await queryRunner.query(`
      UPDATE auth.dealer_profiles
      SET is_verified = verification_status::text
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS auth.idx_dealer_profiles_verification_status
    `);
    await queryRunner.query(`
      ALTER TABLE auth.dealer_profiles
        DROP COLUMN IF EXISTS dealer_type,
        DROP COLUMN IF EXISTS business_registration_number,
        DROP COLUMN IF EXISTS business_address,
        DROP COLUMN IF EXISTS city,
        DROP COLUMN IF EXISTS verification_documents,
        DROP COLUMN IF EXISTS verification_status
    `);
    await queryRunner.query(
      `DROP TYPE IF EXISTS auth.dealer_profiles_dealer_type_enum`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS auth.dealer_profiles_verification_status_enum`,
    );
  }
}
