import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expression indexes for the filter-based search path.
 *
 * Migration 14000 created `idx_vehicles_specs` as a plain gin(specs). That
 * index serves the containment operator (`specs @> '{"body_type":"SUV"}'`)
 * but NOT the arrow operator (`specs->>'body_type' = 'SUV'`), which falls
 * back to a sequential scan. The query builder therefore emits `@>` for spec
 * equality — no new index needed for that case.
 *
 * Ranges are the gap this migration fills. `specs->>'seats' >= '5'` cannot
 * use a containment index and, worse, compares TEXT: '10' < '4'
 * lexicographically. Both slow and wrong. The cast has to be indexed.
 *
 * `status` leads both indexes, matching the convention in migration 14000 —
 * every buyer-facing query gates on status = 'LIVE' first.
 */
export class SpecAndYearSearchIndexes1735000019000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Seat-count range filters: WHERE (specs->>'seats')::int BETWEEN $1 AND $2
    //
    // Partial on the key's presence: rows without a seats spec (bikes,
    // trucks) can never satisfy a seat filter, so they are dead weight in
    // the index. Keeps it small on a mixed-vehicle table.
    await queryRunner.query(`
      CREATE INDEX idx_vehicles_specs_seats
      ON marketplace.vehicles (status, ((specs->>'seats')::int))
      WHERE specs ? 'seats'
    `);

    // Effective-year filters (Decision 3): registration_year is nullable
    // because dealers omit it, so filtering on it directly would make those
    // listings invisible. COALESCE falls back per row to manufacture_year,
    // which is NOT NULL — every vehicle stays reachable.
    //
    // COALESCE in a WHERE clause forces a seq scan unless the exact
    // expression is indexed.
    await queryRunner.query(`
      CREATE INDEX idx_vehicles_year_effective
      ON marketplace.vehicles (status, (COALESCE(registration_year, manufacture_year)))
    `);

    // Mileage is a standard range filter on the buyer UI with no index yet;
    // migration 14000 covered price and manufacture_year but not this.
    await queryRunner.query(`
      CREATE INDEX idx_vehicles_status_mileage
      ON marketplace.vehicles (status, mileage)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS marketplace.idx_vehicles_status_mileage`);
    await queryRunner.query(`DROP INDEX IF EXISTS marketplace.idx_vehicles_year_effective`);
    await queryRunner.query(`DROP INDEX IF EXISTS marketplace.idx_vehicles_specs_seats`);
  }
}
