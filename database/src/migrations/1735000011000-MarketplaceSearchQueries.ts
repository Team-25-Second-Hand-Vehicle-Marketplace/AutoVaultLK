import { MigrationInterface, QueryRunner } from 'typeorm';

export class MarketplaceSearchQueries1735000011000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE marketplace.search_queries (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        -- Nullable: anonymous visitors search too
        user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
        raw_text          text NOT NULL,
        extracted_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
        -- Feeds threshold tuning and the alias-promotion loop.
        -- unresolved_tokens IS the missing-vocabulary list.
        confidence        numeric(4,3),
        used_llm          boolean NOT NULL DEFAULT false,
        unresolved_tokens jsonb NOT NULL DEFAULT '[]'::jsonb,
        result_count      integer NOT NULL DEFAULT 0,
        search_time_ms    integer,
        created_at        timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_search_queries_user_id ON marketplace.search_queries (user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_search_queries_created_at ON marketplace.search_queries (created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE marketplace.search_queries`);
  }
}
