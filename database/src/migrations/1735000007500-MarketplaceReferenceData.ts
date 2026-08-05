import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reference data — Option B (see plan-b-reads-cross-schemas.md §9). Owned
 * solely by marketplace-service. ingestion-service gets read-only access
 * (database/src/grants.sql) and caches a snapshot in memory rather than
 * querying per row. Alias promotion from ingestion goes through
 * marketplace's API, not a direct write — this keeps the platform to one
 * cross-schema write exception (ETL -> vehicles/vehicle_images) instead
 * of two.
 *
 * These are the backing tables for the make/model "dictionaries" — the
 * large, typo-prone vocabularies that a hardcoded array can't handle and
 * that need pg_trgm fuzzy matching. Small closed enums (fuel_type,
 * transmission_type, condition, status) stay as hardcoded arrays + CHECK
 * constraints; they never get a table.
 */
export class MarketplaceReferenceData1735000007500 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
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

    // Polymorphic: entity_id points at makes.id or models.id depending on
    // entity_type. No FK — Postgres can't express a conditional reference
    // across two tables. Integrity here is an application-level concern.
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE marketplace.aliases`);
    await queryRunner.query(`DROP TABLE marketplace.models`);
    await queryRunner.query(`DROP TABLE marketplace.makes`);
  }
}
