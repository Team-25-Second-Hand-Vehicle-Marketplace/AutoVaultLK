import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes make_raw / model_raw from marketplace.vehicles.
 *
 * These held the dealer's original spelling before typo correction, kept
 * for audit and as future input to the alias-promotion loop. Decided not
 * worth the two columns — dropped rather than left unused.
 */
export class DropVehicleRawFields1735000017000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        DROP COLUMN IF EXISTS make_raw,
        DROP COLUMN IF EXISTS model_raw
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        ADD COLUMN make_raw  varchar(100),
        ADD COLUMN model_raw varchar(100)
    `);
  }
}
