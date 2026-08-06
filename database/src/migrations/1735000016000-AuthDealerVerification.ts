import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the dealer-verification columns from the New ERD to
 * auth.dealer_profiles: individual vs. business dealer type, business
 * registration details, uploaded verification documents, and who approved.
 *
 * ⚠ OWNERSHIP NOTE — this migration touches the `auth` schema, which is
 * owned by auth-user-service and its maintainer. It is written here because
 * the central database/ package owns all migrations (see plan-b §2), and
 * because adding the columns to auth-user-service's DealerProfile entity
 * without them existing would stop that service booting (TypeORM validates
 * entity columns against real tables at startup).
 *
 * Coordinate with the auth-user-service maintainer before merging.
 *
 * `company_name` is intentionally kept — it exists in the live table and
 * the New ERD omits it, which appears to be an oversight in the diagram
 * rather than a deliberate removal. Dropping it would lose data.
 */
export class AuthDealerVerification1735000016000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.dealer_profiles
        ADD COLUMN dealer_type varchar(20)
          CHECK (dealer_type IN ('INDIVIDUAL','BUSINESS')),
        ADD COLUMN business_registration_number varchar(100),
        ADD COLUMN business_address varchar(500),
        ADD COLUMN city varchar(100),
        -- S3 references to uploaded NIC / business-registration documents,
        -- stored under a private dealer-verification/ prefix. Kept as jsonb
        -- because an individual uploads one document and a business may
        -- upload several (BR certificate plus optional signatory NIC).
        ADD COLUMN verification_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
        -- The administrator who approved or rejected. SET NULL rather than
        -- CASCADE: the decision record must survive that admin's deletion.
        ADD COLUMN verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
        ADD COLUMN verified_at timestamptz
    `);

    await queryRunner.query(
      `CREATE INDEX idx_dealer_profiles_dealer_type ON auth.dealer_profiles (dealer_type)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_dealer_profiles_verified_by ON auth.dealer_profiles (verified_by)`,
    );

    // A business dealer must have a registration number; an individual
    // must not. Enforced in the database because it is the one rule that
    // distinguishes the two dealer types, and a violation would let an
    // unverifiable business listing reach LIVE.
    await queryRunner.query(`
      ALTER TABLE auth.dealer_profiles
        ADD CONSTRAINT chk_dealer_profiles_business_registration
        CHECK (
          dealer_type IS NULL
          OR (dealer_type = 'BUSINESS' AND business_registration_number IS NOT NULL)
          OR (dealer_type = 'INDIVIDUAL' AND business_registration_number IS NULL)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.dealer_profiles
        DROP CONSTRAINT IF EXISTS chk_dealer_profiles_business_registration
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS auth.idx_dealer_profiles_verified_by`);
    await queryRunner.query(`DROP INDEX IF EXISTS auth.idx_dealer_profiles_dealer_type`);
    await queryRunner.query(`
      ALTER TABLE auth.dealer_profiles
        DROP COLUMN IF EXISTS verified_at,
        DROP COLUMN IF EXISTS verified_by,
        DROP COLUMN IF EXISTS verification_documents,
        DROP COLUMN IF EXISTS city,
        DROP COLUMN IF EXISTS business_address,
        DROP COLUMN IF EXISTS business_registration_number,
        DROP COLUMN IF EXISTS dealer_type
    `);
  }
}
