import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class MarketplaceVehicleImagesWriteAdapter {
  private readonly logger = new Logger(MarketplaceVehicleImagesWriteAdapter.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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
