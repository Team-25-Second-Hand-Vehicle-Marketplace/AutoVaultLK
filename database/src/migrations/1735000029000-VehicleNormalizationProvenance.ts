import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FR-42.1: the dealer's review interface must show which fields on a
 * PENDING_REVIEW listing were inferred by the Groq normalisation step, along
 * with the model's stated reasoning, and must be able to sort rows by
 * ascending confidence.
 *
 * None of that is currently derivable. The pipeline computes a per-field
 * confidence during parseNormalize (FR-33.1) and collapses it into a single
 * row-level `confidence: number` (FR-33.2) that never leaves NormalizedRow —
 * nothing persists which fields were touched, by what method, or why. This
 * column is where that gets to survive past the pipeline run.
 *
 * One JSONB column rather than parallel scalar columns:
 *  - the field set is open (any VehicleFields key may carry provenance, and
 *    new fields should not need a migration to become reviewable);
 *  - a manually-created listing has no provenance at all, and NULL says that
 *    directly rather than needing eleven NULL columns to say it once;
 *  - the review UI reads it as one blob per listing, never filters or sorts
 *    Postgres by an individual field's provenance, so there is no query this
 *    would need to be relational for.
 *
 * Shape written by the pipeline (see pipeline/types.ts FieldProvenance):
 *   {
 *     "fields": {
 *       "make":  { "source": "dictionary", "confidence": 0.8 },
 *       "model": { "source": "groq", "confidence": 0.8, "reasoning": "..." },
 *       "price": { "source": "raw", "confidence": 1 }
 *     },
 *     "rowConfidence": 0.8
 *   }
 *
 * Nullable, so every one of the 27 migrations' worth of existing rows, and
 * every manually-created listing going forward, is simply absent rather than
 * needing a default that would be a fabrication.
 */
export class VehicleNormalizationProvenance1735000029000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        ADD COLUMN normalization jsonb NULL
    `);

    // Powers "confidence ascending" sort/filter for PENDING_REVIEW rows
    // without a full-table scan; partial because LIVE/SOLD/ARCHIVED/REJECTED
    // rows are never queried by this and most have no normalization at all.
    await queryRunner.query(`
      CREATE INDEX vehicles_pending_review_confidence_idx
        ON marketplace.vehicles (((normalization->>'rowConfidence')::numeric))
        WHERE status = 'PENDING_REVIEW' AND normalization IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS marketplace.vehicles_pending_review_confidence_idx
    `);
    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        DROP COLUMN IF EXISTS normalization
    `);
  }
}
