import { MigrationInterface, QueryRunner } from 'typeorm';

export class IngestionEtlStageLogs1735000009000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ingestion.etl_stage_logs (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        upload_job_id uuid NOT NULL REFERENCES ingestion.upload_jobs(id) ON DELETE CASCADE,
        stage         varchar(40) NOT NULL
                      CHECK (stage IN ('VALIDATE_FILE','SPLIT_CHUNKS','PARSE_NORMALIZE',
                                       'GROQ_NORMALIZE','VALIDATE_ROWS','ENRICH','EMBED',
                                       'LOAD','PROCESS_IMAGES','AGGREGATE','NOTIFY')),
        status        varchar(20) NOT NULL
                      CHECK (status IN ('STARTED','SUCCEEDED','FAILED','SKIPPED','DEGRADED')),
        chunk_id      integer,
        retry_count   integer NOT NULL DEFAULT 0,
        started_at    timestamptz,
        completed_at  timestamptz,
        error_message text,
        -- Confidence scores land here from day one so the 0.6 threshold
        -- can be tuned against real dealer files.
        metrics       jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_etl_stage_logs_upload_job_id ON ingestion.etl_stage_logs (upload_job_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_etl_stage_logs_stage_status ON ingestion.etl_stage_logs (stage, status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ingestion.etl_stage_logs`);
  }
}
