import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FR-35.2: a bulk row with a null or blank registration_number is loaded
 * without failure (there is nothing wrong with the row — unregistered
 * imports are legitimate stock), but it cannot receive an automated image
 * match, so it needs to surface distinctly in the dealer's review queue
 * rather than blend into the blanket PENDING_REVIEW status every bulk row
 * already gets.
 *
 * `needs_manual_review` is deliberately separate from `status`: status
 * governs whether a listing is publicly visible, while this flag governs
 * whether the review UI should call it out as needing dealer attention
 * before publish. A PENDING_REVIEW row with no flag is just "awaiting the
 * dealer's normal review pass"; one with the flag set needs a photo
 * attached (or the flag cleared) before it should go LIVE.
 *
 * `review_reason` is a short machine code, not free text, so the review UI
 * can branch on it (icon, filter, sort) without parsing a sentence. Nullable
 * and only meaningful when needs_manual_review is true.
 */
export class VehicleManualReviewFlag1735000030000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        ADD COLUMN needs_manual_review boolean NOT NULL DEFAULT false,
        ADD COLUMN review_reason varchar(50) NULL
    `);

    // Powers the dealer review queue's "needs attention" filter without a
    // full-table scan; partial because most rows never set the flag.
    await queryRunner.query(`
      CREATE INDEX vehicles_needs_manual_review_idx
        ON marketplace.vehicles (dealer_id)
        WHERE needs_manual_review
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS marketplace.vehicles_needs_manual_review_idx
    `);
    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        DROP COLUMN IF EXISTS review_reason,
        DROP COLUMN IF EXISTS needs_manual_review
    `);
  }
}
