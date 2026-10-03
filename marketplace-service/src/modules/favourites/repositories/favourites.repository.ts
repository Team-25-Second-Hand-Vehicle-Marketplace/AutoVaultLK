import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Favourite } from '../../../infrastructure/database/entities/favourite.entity';

@Injectable()
export class FavouritesRepository {
  constructor(
    @InjectRepository(Favourite)
    private readonly repository: Repository<Favourite>,
  ) {}

  async createFavourite(
    buyerId: string,
    vehicleId: string,
  ): Promise<Favourite> {
    const favourite = this.repository.create({
      buyerId,
      vehicleId,
    });

    return this.repository.save(favourite);
  }

  async findFavourite(
    buyerId: string,
    vehicleId: string,
  ): Promise<Favourite | null> {
    return this.repository.findOne({
      where: {
        buyerId,
        vehicleId,
      },
    });
  }

  async findByBuyer(
    buyerId: string,
  ): Promise<Favourite[]> {
    return this.repository.find({
      where: {
        buyerId,
      },
      relations: {
        vehicle: true,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  /**
   * The primary photo's stored paths for each vehicle, keyed by vehicle id.
   *
   * One query for the whole list rather than one per saved vehicle. Mirrors the
   * search repository's choice of image - `COALESCE(processed_path, s3_path)` -
   * so a vehicle shows the same photo whether it is found by search or saved.
   * A vehicle with no photo has no entry; the card shows its placeholder.
   */
  async findPrimaryImagePaths(
    vehicleIds: string[],
  ): Promise<Map<string, { imagePath: string | null; thumbnailPath: string | null }>> {
    if (vehicleIds.length === 0) return new Map();

    const rows: Array<{
      vehicle_id: string;
      image_path: string | null;
      thumbnail_path: string | null;
    }> = await this.repository.manager.query(
      `SELECT DISTINCT ON (vi.vehicle_id)
              vi.vehicle_id,
              COALESCE(vi.processed_path, vi.s3_path) AS image_path,
              vi.thumbnail_path
         FROM marketplace.vehicle_images vi
        WHERE vi.vehicle_id = ANY($1::uuid[])
        ORDER BY vi.vehicle_id, vi.is_primary DESC, vi.display_order ASC`,
      [vehicleIds],
    );

    return new Map(
      rows.map((row) => [
        row.vehicle_id,
        { imagePath: row.image_path, thumbnailPath: row.thumbnail_path },
      ]),
    );
  }

  async deleteFavourite(
    buyerId: string,
    vehicleId: string,
  ): Promise<void> {
    await this.repository.delete({
      buyerId,
      vehicleId,
    });
  }
}