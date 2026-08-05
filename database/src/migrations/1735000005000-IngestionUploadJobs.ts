import { MigrationInterface, QueryRunner } from 'typeorm';

export class IngestionUploadJobs1735000005000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ingestion.upload_jobs (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        dealer_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        file_name       varchar(255) NOT NULL,
        csv_s3_path     varchar(500) NOT NULL,
        zip_s3_path     varchar(500),
        status          varchar(20)  NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','PARTIAL')),
        total_records   integer NOT NULL DEFAULT 0,
        valid_records   integer NOT NULL DEFAULT 0,
        invalid_records integer NOT NULL DEFAULT 0,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_upload_jobs_dealer_id ON ingestion.upload_jobs (dealer_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_upload_jobs_status ON ingestion.upload_jobs (status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ingestion.upload_jobs`);
  }
}
