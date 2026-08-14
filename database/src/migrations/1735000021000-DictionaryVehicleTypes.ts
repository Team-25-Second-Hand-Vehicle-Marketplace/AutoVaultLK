import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds vehicle-type scoping to the dictionary so make/model dropdowns can
 * be filtered by the selected vehicle type.
 *
 * Makes span types (Toyota builds cars, vans, SUVs and lorries), so a MAKE
 * row carries an array. Models do not (a HiAce is always a van), so a MODEL
 * row carries a single-element array — one column, one shape, no special
 * casing in the query builder.
 *
 * Empty array = "applies to every type", which keeps the column optional
 * for flat dictionary types (BODY_TYPE, COLOR) that have no type scoping.
 *
 * Table is empty at time of writing, so no backfill is required.
 */
export class DictionaryVehicleTypes1735000021000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE marketplace.vehicle_dictionaries
        ADD COLUMN vehicle_types text[] NOT NULL DEFAULT '{}'
    `);

    // GIN supports the containment query the dropdowns run:
    //   WHERE vehicle_types @> ARRAY['BIKE']
    await queryRunner.query(`
      CREATE INDEX idx_vehicle_dictionaries_vehicle_types
      ON marketplace.vehicle_dictionaries USING gin (vehicle_types)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS marketplace.idx_vehicle_dictionaries_vehicle_types
    `);
    await queryRunner.query(`
      ALTER TABLE marketplace.vehicle_dictionaries DROP COLUMN vehicle_types
    `);
  }
}
