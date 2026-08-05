import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthDealerProfiles1735000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // user_id is both PK and FK — one profile per user (ERD: "has (if dealer)")
    await queryRunner.query(`
      CREATE TABLE auth.dealer_profiles (
        user_id        uuid PRIMARY KEY
                       REFERENCES auth.users(id) ON DELETE CASCADE,
        company_name   varchar(255) NOT NULL,
        contact_number varchar(50),
        is_verified    varchar(20)  NOT NULL DEFAULT 'PENDING'
                       CHECK (is_verified IN ('PENDING','VERIFIED','REJECTED')),
        created_at     timestamptz  NOT NULL DEFAULT now(),
        updated_at     timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_dealer_profiles_is_verified ON auth.dealer_profiles (is_verified)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE auth.dealer_profiles`);
  }
}
