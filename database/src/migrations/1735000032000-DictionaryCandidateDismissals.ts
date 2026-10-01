import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backs the admin "New vehicle types" review tab: a dealer's raw make text
 * that never resolved (ingestion.rejected_records, "make ... could not be
 * recognised") is a candidate for either a brand-new dictionary entry or an
 * alias of an existing one - but plenty of what lands there is just noise
 * (a one-off typo, a blank, a placeholder like "N/A"). An admin dismissing a
 * candidate must stick, or the same noise reappears every time the tab is
 * reopened.
 *
 * Lives in the admin schema, not marketplace's: this is purely a
 * review-workflow record ("an admin looked at this text and decided it's not
 * worth adding"), not a marketplace domain concept, and admin_service_role
 * only has read access to marketplace/ingestion - this table needs writes.
 *
 * `raw_value` is the normalized (lower-cased, trimmed) form of the dealer's
 * text, matching the same normalization the aggregation query groups by, so
 * a dismissal actually suppresses every casing/whitespace variant of the same
 * typo rather than just the one exact string first seen.
 */
export class DictionaryCandidateDismissals1735000032000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE admin.dictionary_candidate_dismissals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        dictionary_type varchar(20) NOT NULL,
        raw_value varchar(100) NOT NULL,
        dismissed_by uuid NULL,
        dismissed_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (dictionary_type, raw_value)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS admin.dictionary_candidate_dismissals
    `);
  }
}
