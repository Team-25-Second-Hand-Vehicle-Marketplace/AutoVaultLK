import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ETL Load upsert key (ADR-002 / FR-41): ingestion-service uses
 * ON CONFLICT (upload_job_id, registration_number) DO UPDATE when persisting
 * rows from a bulk upload. The global partial unique on registration_number
 * alone (migration 6000) enforces FR-35.1 across jobs; this composite index
 * makes within-job retries idempotent.
 */
export class VehicleJobRegistrationUpsertIndex1735000019000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_vehicles_job_registration
      ON marketplace.vehicles (upload_job_id, registration_number)
      WHERE upload_job_id IS NOT NULL
        AND registration_number IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS marketplace.idx_vehicles_job_registration`,
    );
  }
}
