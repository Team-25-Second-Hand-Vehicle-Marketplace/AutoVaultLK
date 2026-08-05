import { MigrationInterface, QueryRunner } from 'typeorm';

export class IngestionRejectedRecords1735000008000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ingestion.rejected_records (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        upload_job_id uuid NOT NULL REFERENCES ingestion.upload_jobs(id) ON DELETE CASCADE,
        row_number    integer NOT NULL,
        raw_data      jsonb   NOT NULL,
        reason        varchar(500) NOT NULL,
        created_at    timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_rejected_records_upload_job_id ON ingestion.rejected_records (upload_job_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ingestion.rejected_records`);
  }
}
