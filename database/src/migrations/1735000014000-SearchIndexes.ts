import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Search indexes live in their own migration because they are slow to
 * build and will be tuned (HNSW parameters especially) independently of
 * the table definitions they sit on.
 */
export class SearchIndexes1735000014000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // HNSW for cosine distance. Matches ORDER BY embedding <=> $1.
    // Slow to build on large tables — expected.
    await queryRunner.query(`
      CREATE INDEX idx_vehicles_embedding_hnsw
      ON marketplace.vehicles
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `);

    // Keyword-exact layer (dealer names, trim codes) — the third of
    // "three layers, three jobs" alongside trgm and pgvector.
    await queryRunner.query(`
      CREATE INDEX idx_vehicles_search_vector
      ON marketplace.vehicles USING gin (search_vector)
    `);

    // Trigram on search_text — ONLY for the gated last-resort retrieval
    // path (when nothing resolved). Never for re-matching resolved values.
    await queryRunner.query(`
      CREATE INDEX idx_vehicles_search_text_trgm
      ON marketplace.vehicles USING gin (search_text gin_trgm_ops)
    `);

    // specs JSONB — supports specFilters lookups (body_type, seats,
    // sunroof, airbags, etc.) via specs->>'key' filter clauses.
    await queryRunner.query(`
      CREATE INDEX idx_vehicles_specs ON marketplace.vehicles USING gin (specs)
    `);

    // status leads every composite: every buyer-facing query gates on
    // status = 'LIVE' first.
    await queryRunner.query(`
      CREATE INDEX idx_vehicles_status_make_model
      ON marketplace.vehicles (status, make, model)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_vehicles_status_price
      ON marketplace.vehicles (status, price)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_vehicles_status_year
      ON marketplace.vehicles (status, manufacture_year)
    `);

    // Keeps search_vector in sync with search_text automatically, so no
    // service can forget to update it.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION marketplace.vehicles_search_vector_update()
      RETURNS trigger AS $$
      BEGIN
        NEW.search_vector := to_tsvector('english', COALESCE(NEW.search_text, ''));
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_vehicles_search_vector
      BEFORE INSERT OR UPDATE OF search_text ON marketplace.vehicles
      FOR EACH ROW EXECUTE FUNCTION marketplace.vehicles_search_vector_update()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_vehicles_search_vector ON marketplace.vehicles`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS marketplace.vehicles_search_vector_update()`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS marketplace.idx_vehicles_status_year`);
    await queryRunner.query(`DROP INDEX IF EXISTS marketplace.idx_vehicles_status_price`);
    await queryRunner.query(`DROP INDEX IF EXISTS marketplace.idx_vehicles_status_make_model`);
    await queryRunner.query(`DROP INDEX IF EXISTS marketplace.idx_vehicles_specs`);
    await queryRunner.query(`DROP INDEX IF EXISTS marketplace.idx_vehicles_search_text_trgm`);
    await queryRunner.query(`DROP INDEX IF EXISTS marketplace.idx_vehicles_search_vector`);
    await queryRunner.query(`DROP INDEX IF EXISTS marketplace.idx_vehicles_embedding_hnsw`);
  }
}
