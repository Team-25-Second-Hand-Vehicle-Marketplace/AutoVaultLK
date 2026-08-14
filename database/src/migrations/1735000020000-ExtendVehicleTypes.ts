import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extends vehicle_type beyond the original six.
 *
 * ⚠️ FOUR PLACES MUST AGREE (plan-b §risk-4). Changing this CHECK alone is
 * not enough — ingestion-service writes to marketplace.vehicles without
 * importing marketplace's entities, so a mismatch fails at the database
 * with no compile-time warning:
 *   1. this CHECK constraint
 *   2. marketplace-service .../entities/vehicle.entity.ts  (VehicleType)
 *   3. ingestion-service  .../entities/vehicle.write-entity.ts
 *   4. marketplace-service .../search/constants/vehicle-attributes.constants.ts
 *
 * Excluded deliberately: SCOOTER (a body style within BIKE -> specs.body_type)
 * and QUADRICYCLE (too rare to earn a top-level filter). Enum values are for
 * categories buyers filter by; anything finer belongs in specs.
 */
export class ExtendVehicleTypes1735000020000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        DROP CONSTRAINT IF EXISTS vehicles_vehicle_type_check
    `);

    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        ADD CONSTRAINT vehicles_vehicle_type_check
        CHECK (vehicle_type IN (
          'CAR','BIKE','VAN','TRUCK','SUV','BUS',
          'THREE_WHEELER','LORRY','PICKUP','TRACTOR','HEAVY_MACHINERY'
        ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rows using a new type would violate the old constraint. Park them as
    // TRUCK (the nearest original category) so the rollback cannot fail.
    await queryRunner.query(`
      UPDATE marketplace.vehicles
      SET vehicle_type = 'TRUCK'
      WHERE vehicle_type IN ('THREE_WHEELER','LORRY','PICKUP','TRACTOR','HEAVY_MACHINERY')
    `);

    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        DROP CONSTRAINT IF EXISTS vehicles_vehicle_type_check
    `);

    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        ADD CONSTRAINT vehicles_vehicle_type_check
        CHECK (vehicle_type IN ('CAR','BIKE','VAN','TRUCK','SUV','BUS'))
    `);
  }
}
