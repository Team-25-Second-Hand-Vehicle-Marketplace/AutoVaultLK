import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SECOND HALF OF THE ADR-002 CROSS-SCHEMA WRITE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sibling of MarketplaceVehiclesWriteAdapter. `ingestion_service_role` holds
 * SELECT + INSERT + UPDATE on marketplace.vehicle_images and DELETE on
 * neither, and the grant is only defensible while every write to that table
 * goes through this class.
 *
 * **B3 injects this rather than writing SQL.** Adding a repository elsewhere
 * does not break a test; it dissolves the architectural claim silently, which
 * is why an integration test asserts the role holds no DELETE.
 */
@Injectable()
export class MarketplaceVehicleImagesWriteAdapter {
  private readonly logger = new Logger(MarketplaceVehicleImagesWriteAdapter.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Inserts the images for one vehicle.
   *
   * **`idx_vehicle_images_one_primary` is a partial unique index on
   * `(vehicle_id) WHERE is_primary`** — a second `is_primary = true` for the
   * same vehicle raises 23505 and takes the whole statement with it. The
   * caller is not trusted to get that right: `primaryIndex` names which image
   * is primary and every other row is forced false, so a batch cannot violate
   * the index however it was assembled upstream.
   *
   * Re-running is safe. The conflict target is (vehicle_id, s3_path): the same
   * source file for the same vehicle updates its processed paths rather than
   * inserting a duplicate, which is what makes an ASL retry of PROCESS_IMAGES
   * idempotent.
   */
  async insertForVehicle(
    vehicleId: string,
    images: VehicleImageInput[],
    primaryIndex = 0,
  ): Promise<InsertedImage[]> {
    if (images.length === 0) return [];

    const values: string[] = [];
    const params: unknown[] = [];

    images.forEach((image, index) => {
      const start = params.length;
      params.push(
        vehicleId,
        image.s3Path,
        image.processedPath ?? null,
        image.thumbnailPath ?? null,
        index === primaryIndex,
        image.displayOrder ?? index,
      );
      values.push(
        `($${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6})`,
      );
    });

    return (await this.dataSource.query(
      `INSERT INTO marketplace.vehicle_images
         (vehicle_id, s3_path, processed_path, thumbnail_path, is_primary, display_order)
       VALUES ${values.join(', ')}
       ON CONFLICT (vehicle_id, s3_path) DO UPDATE SET
         processed_path = EXCLUDED.processed_path,
         thumbnail_path = EXCLUDED.thumbnail_path,
         display_order  = EXCLUDED.display_order
       RETURNING id, vehicle_id, is_primary`,
      params,
    )) as InsertedImage[];
  }

  /**
   * Resolves registration numbers to vehicle ids for one job.
   *
   * B3 matches image filenames to vehicles by registration number
   * (`{REG}_1.jpg`), and this is the lookup for it. Scoped to the job so a
   * dealer's upload cannot attach images to another dealer's stock that
   * happens to share a plate.
   *
   * Returns a Map keyed by the *canonical* registration number — the same form
   * coerceRegistrationNumber produces (`CAB-1234`), so a filename must be
   * folded through it before lookup or `cab1234.jpg` will miss.
   */
  async vehicleIdsByRegistration(jobId: string): Promise<Map<string, string>> {
    const rows = (await this.dataSource.query(
      `SELECT id, registration_number
         FROM marketplace.vehicles
        WHERE upload_job_id = $1 AND registration_number IS NOT NULL`,
      [jobId],
    )) as { id: string; registration_number: string }[];

    return new Map(rows.map((row) => [row.registration_number, row.id]));
  }

  /** How many images this job has landed. Used by aggregate and by retries. */
  async countForJob(jobId: string): Promise<number> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS count
         FROM marketplace.vehicle_images i
         JOIN marketplace.vehicles v ON v.id = i.vehicle_id
        WHERE v.upload_job_id = $1`,
      [jobId],
    )) as { count: number }[];

    return row?.count ?? 0;
  }
}

export type VehicleImageInput = {
  /** Key of the original file, `images/{jobId}/{reg}/{n}.jpg`. */
  s3Path: string;
  processedPath?: string | null;
  thumbnailPath?: string | null;
  displayOrder?: number;
};

export type InsertedImage = {
  id: string;
  vehicle_id: string;
  is_primary: boolean;
};
