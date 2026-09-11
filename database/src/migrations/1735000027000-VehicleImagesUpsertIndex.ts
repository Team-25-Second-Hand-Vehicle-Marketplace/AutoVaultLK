import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Unique index on (vehicle_id, s3_path), the upsert key for image ingestion.
 *
 * Without it, re-running the PROCESS_IMAGES stage inserts a second row for the
 * same source file: a dealer would see one photo listed twice, and
 * display_order would no longer mean anything. Step Functions retries a failed
 * state by re-invoking it, so that retry is routine rather than exceptional —
 * the same reasoning behind migration 26000 for rejected_records.
 *
 * Deliberately NOT partial. Both columns are NOT NULL, so every row is covered
 * and the ON CONFLICT target needs no predicate — unlike
 * idx_vehicles_job_registration, where a null registration number is
 * legitimate and forces the WHERE clause into the conflict target.
 */
export class VehicleImagesUpsertIndex1735000027000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing duplicates would fail the index creation. Keep the earliest row
    // per (vehicle, path): it is the one whose id other rows may already
    // reference, and the later ones are the accidental re-inserts this index
    // exists to prevent.
    await queryRunner.query(`
      DELETE FROM marketplace.vehicle_images a
       USING marketplace.vehicle_images b
       WHERE a.vehicle_id = b.vehicle_id
         AND a.s3_path = b.s3_path
         AND a.created_at > b.created_at
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_vehicle_images_vehicle_path
      ON marketplace.vehicle_images (vehicle_id, s3_path)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS marketplace.idx_vehicle_images_vehicle_path`,
    );
  }
}
