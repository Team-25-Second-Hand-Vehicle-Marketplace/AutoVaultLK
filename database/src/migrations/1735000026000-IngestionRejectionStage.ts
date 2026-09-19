import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `stage` to ingestion.rejected_records, and a partial unique index that
 * makes re-running one stage idempotent.
 *
 * Under Step Functions each pipeline stage is its own Lambda, and ASL retries a
 * failed state by re-invoking it. A stage that rejected rows before failing
 * would insert those rejections a second time on the retry, so a dealer would
 * see the same bad row listed twice with no way to tell it was one row.
 *
 * In-process this never came up: the orchestrator accumulated rejections across
 * stages and wrote them once per chunk. That accumulator cannot exist across
 * Lambdas, so each stage now persists its own — and needs a key to be idempotent
 * against.
 *
 * (upload_job_id, stage, row_number) is that key. It is partial on
 * `row_number > 0` because row 0 is the whole-file rejection validateFile
 * writes; a job can legitimately have only one of those, but making the index
 * total would collide if a file failed validation twice on retry, which is
 * exactly a case we want to allow to overwrite rather than reject.
 */
export class IngestionRejectionStage1735000026000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable, then backfilled, then set NOT NULL: existing rows predate the
    // column and there is no honest stage to attribute them to beyond
    // "something rejected this".
    await queryRunner.query(
      `ALTER TABLE ingestion.rejected_records ADD COLUMN stage varchar(30)`,
    );

    await queryRunner.query(
      `UPDATE ingestion.rejected_records SET stage = 'VALIDATE_ROWS' WHERE stage IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE ingestion.rejected_records ALTER COLUMN stage SET NOT NULL`,
    );

    // Must list every EtlStage value that can reject a row. VALIDATE_FILE
    // rejects the whole file as row 0; VALIDATE_ROWS and LOAD reject
    // individual rows. The others never reject — that is the pipeline's
    // central rule — but are permitted here so a future stage that does need
    // to does not require a migration.
    await queryRunner.query(`
      ALTER TABLE ingestion.rejected_records
      ADD CONSTRAINT rejected_records_stage_check CHECK (stage IN (
        'VALIDATE_FILE','SPLIT_CHUNKS','PARSE_NORMALIZE','GROQ_NORMALIZE',
        'VALIDATE_ROWS','ENRICH','EMBED','LOAD','PROCESS_IMAGES'
      ))
    `);

    // The idempotency key. ON CONFLICT DO UPDATE against this target lets a
    // retried stage replace its own rejections instead of duplicating them.
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_rejected_records_job_stage_row
      ON ingestion.rejected_records (upload_job_id, stage, row_number)
      WHERE row_number > 0
    `);

    // Row 0 is the whole-file rejection: one per job per stage, no row number
    // to key on.
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_rejected_records_job_stage_file
      ON ingestion.rejected_records (upload_job_id, stage)
      WHERE row_number = 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS ingestion.idx_rejected_records_job_stage_file`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS ingestion.idx_rejected_records_job_stage_row`,
    );
    await queryRunner.query(
      `ALTER TABLE ingestion.rejected_records DROP CONSTRAINT IF EXISTS rejected_records_stage_check`,
    );
    await queryRunner.query(`ALTER TABLE ingestion.rejected_records DROP COLUMN stage`);
  }
}
