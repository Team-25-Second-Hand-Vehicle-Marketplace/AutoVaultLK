import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replaces the three-table reference design (makes / models / aliases) with
 * a single self-referencing dictionary table, per the New ERD.
 *
 * Why the change:
 *  - One table serves makes, models, and any future dictionary type
 *    (body types, colours, trims) with no new migrations.
 *  - `aliases jsonb` removes the polymorphic-FK weakness of the old
 *    `aliases.entity_id`, which could not have a foreign key because it
 *    pointed at either makes.id or models.id depending on entity_type.
 *  - `parent_id` expresses make -> model containment directly, so a model
 *    lookup scoped to a resolved make is a plain `WHERE parent_id = $1`.
 *
 * Safe to drop the old tables: all three were empty (never seeded).
 *
 * Ownership unchanged — marketplace-service owns this table.
 * ingestion-service holds SELECT only and caches a snapshot at container
 * init; alias promotion goes through marketplace's API, not a direct write.
 * See database/src/grants.sql.
 */
export class VehicleDictionaries1735000015000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE marketplace.vehicle_dictionaries (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Self-reference: a MODEL row points at its MAKE row.
        -- NULL for MAKE rows and for any flat dictionary type.
        parent_id       uuid REFERENCES marketplace.vehicle_dictionaries(id)
                        ON DELETE CASCADE,

        dictionary_type varchar(20) NOT NULL
                        CHECK (dictionary_type IN ('MAKE','MODEL','BODY_TYPE','COLOR')),

        canonical_value varchar(100) NOT NULL,

        -- Known misspellings and colloquial forms, e.g.
        -- ["toyata","toyata motors"] or ["benz"] for Mercedes-Benz.
        -- Seeded by hand and grown by the alias-promotion loop.
        aliases         jsonb NOT NULL DEFAULT '[]'::jsonb,

        is_active       boolean NOT NULL DEFAULT true,
        created_at      timestamptz NOT NULL DEFAULT now(),

        -- A canonical value is unique within its type and parent. Two
        -- different makes may both have a "Civic"; one make may not.
        CONSTRAINT uq_vehicle_dictionaries_value
          UNIQUE (dictionary_type, parent_id, canonical_value)
      )
    `);

    // Trigram index for typo correction — the reason this is a table at
    // all rather than a hardcoded array. similarity() needs a GIN index.
    await queryRunner.query(`
      CREATE INDEX idx_vehicle_dictionaries_value_trgm
      ON marketplace.vehicle_dictionaries
      USING gin (canonical_value gin_trgm_ops)
    `);

    // Scoped model lookup: WHERE dictionary_type='MODEL' AND parent_id=$1
    await queryRunner.query(`
      CREATE INDEX idx_vehicle_dictionaries_type_parent
      ON marketplace.vehicle_dictionaries (dictionary_type, parent_id)
    `);

    // Alias matching. jsonb_path_ops is smaller and faster than the
    // default for the containment queries used here.
    await queryRunner.query(`
      CREATE INDEX idx_vehicle_dictionaries_aliases
      ON marketplace.vehicle_dictionaries
      USING gin (aliases jsonb_path_ops)
    `);

    // Old three-table design. All empty — nothing to migrate across.
    // Dropped in FK-safe order: aliases has no FK, models references makes.
    await queryRunner.query(`DROP TABLE IF EXISTS marketplace.aliases`);
    await queryRunner.query(`DROP TABLE IF EXISTS marketplace.models`);
    await queryRunner.query(`DROP TABLE IF EXISTS marketplace.makes`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the three-table design exactly as migration 7500 created it.
    await queryRunner.query(`
      CREATE TABLE marketplace.makes (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        canonical_name varchar(100) NOT NULL UNIQUE,
        is_active      boolean NOT NULL DEFAULT true,
        created_at     timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_makes_name_trgm
      ON marketplace.makes USING gin (canonical_name gin_trgm_ops)
    `);

    await queryRunner.query(`
      CREATE TABLE marketplace.models (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        make_id        uuid NOT NULL REFERENCES marketplace.makes(id) ON DELETE CASCADE,
        canonical_name varchar(100) NOT NULL,
        is_active      boolean NOT NULL DEFAULT true,
        created_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_models_make_name UNIQUE (make_id, canonical_name)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_models_make_id ON marketplace.models (make_id)`);
    await queryRunner.query(`
      CREATE INDEX idx_models_name_trgm
      ON marketplace.models USING gin (canonical_name gin_trgm_ops)
    `);

    await queryRunner.query(`
      CREATE TABLE marketplace.aliases (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        alias       varchar(100) NOT NULL,
        entity_type varchar(20)  NOT NULL CHECK (entity_type IN ('MAKE','MODEL')),
        entity_id   uuid NOT NULL,
        source      varchar(20)  NOT NULL DEFAULT 'SEED'
                    CHECK (source IN ('SEED','GROQ_PROMOTED','MANUAL')),
        hit_count   integer NOT NULL DEFAULT 0,
        created_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_aliases_alias_type UNIQUE (alias, entity_type)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_aliases_alias_trgm
      ON marketplace.aliases USING gin (alias gin_trgm_ops)
    `);

    await queryRunner.query(`DROP TABLE marketplace.vehicle_dictionaries`);
  }
}
