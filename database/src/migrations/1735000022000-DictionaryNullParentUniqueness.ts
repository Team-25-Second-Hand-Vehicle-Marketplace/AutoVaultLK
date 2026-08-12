import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes a real bug: uq_vehicle_dictionaries_value is
 * UNIQUE(dictionary_type, parent_id, canonical_value), but Postgres never
 * treats two NULLs as equal in a unique constraint. MAKE and BODY_TYPE rows
 * always have parent_id = NULL, so ON CONFLICT on that constraint silently
 * never fired for them — running the dictionary seed twice duplicated every
 * make and body type (30 -> 60, 10 -> 20) with no error. MODEL rows were
 * unaffected because their parent_id is a real (non-null) value.
 *
 * A partial unique index scoped to `WHERE parent_id IS NULL` closes the
 * gap: Postgres partial indexes DO enforce uniqueness among matching rows
 * regardless of NULL comparison semantics, because the index key here is
 * just (dictionary_type, canonical_value) — parent_id isn't part of it at
 * all, it's only the filter that selects which rows the index covers.
 */
export class DictionaryNullParentUniqueness1735000022000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Defensive: dedupe any pre-existing bad data before adding the index,
    // so this migration is safe to run against a database that already has
    // the duplicate-seed bug's symptoms (as this one did). Keeps whichever
    // copy of each (type, value) has the most children, oldest as tiebreak;
    // ON DELETE CASCADE on parent_id cleans up any orphaned children.
    await queryRunner.query(`
      DELETE FROM marketplace.vehicle_dictionaries
      WHERE parent_id IS NULL
        AND id NOT IN (
          SELECT DISTINCT ON (dictionary_type, canonical_value) id
          FROM marketplace.vehicle_dictionaries
          WHERE parent_id IS NULL
          ORDER BY dictionary_type, canonical_value,
            (SELECT count(*) FROM marketplace.vehicle_dictionaries m
             WHERE m.parent_id = vehicle_dictionaries.id) DESC,
            created_at ASC
        )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_dictionaries_value_null_parent
      ON marketplace.vehicle_dictionaries (dictionary_type, canonical_value)
      WHERE parent_id IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS marketplace.uq_vehicle_dictionaries_value_null_parent
    `);
  }
}
