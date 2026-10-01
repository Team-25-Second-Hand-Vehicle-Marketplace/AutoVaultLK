import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which format a dealer's inventory file was uploaded in, so the ETL
 * worker picks the matching reader instead of guessing from the extension.
 *
 * Defaults to 'csv' so every existing row, and every client that predates JSON
 * support, keeps meaning exactly what it meant before. The CHECK keeps the set
 * of formats closed: adding one is a deliberate migration, not a stray string.
 */
export class IngestionUploadJobFileFormat1735000033000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ingestion.upload_jobs
        ADD COLUMN file_format varchar(10) NOT NULL DEFAULT 'csv'
          CHECK (file_format IN ('csv', 'json'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ingestion.upload_jobs DROP COLUMN file_format
    `);
  }
}
