import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface RecommendedVehicle {
  id: string;
  vehicleType: string;
  make: string;
  model: string;
  manufactureYear: number;
  registrationYear: number | null;
  price: number;
  mileage: number;
  fuelType: string | null;
  transmissionType: string | null;
  locationCity: string | null;
  locationDistrict: string | null;
  condition: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  dealerVerified: boolean;
  similarityScore: number;
}

@Injectable()
export class RecommendationsRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findSimilarVehicles(
    vehicleId: string,
    limit = 6,
  ): Promise<RecommendedVehicle[]> {
    const rows: Array<{
      id: string;
      vehicle_type: string;
      make: string;
      model: string;
      manufacture_year: number;
      registration_year: number | null;
      price: string;
      mileage: number;
      fuel_type: string | null;
      transmission_type: string | null;
      location_city: string | null;
      location_district: string | null;
      condition: string | null;
      image_path: string | null;
      thumbnail_path: string | null;
      dealer_verified: boolean | null;
      similarity_score: number;
    }> = await this.dataSource.query(
      `
      WITH target AS (
        SELECT
          id,
          vehicle_type,
          make,
          model,
          manufacture_year,
          price,
          mileage,
          fuel_type,
          transmission_type,
          location_city,
          condition
        FROM marketplace.vehicles
        WHERE id = $1
      )

      SELECT
        v.id,
        v.vehicle_type,
        v.make,
        v.model,
        v.manufacture_year,
        v.registration_year,
        v.price,
        v.mileage,
        v.fuel_type,
        v.transmission_type,
        v.location_city,
        v.location_district,
        v.condition,

        COALESCE(vi.processed_path, vi.s3_path) AS image_path,
        vi.thumbnail_path,

        (dp.verification_status = 'VERIFIED') AS dealer_verified,

        (
          CASE
            WHEN v.make = t.make THEN 30
            ELSE 0
          END

          +

          CASE
            WHEN v.model = t.model THEN 30
            ELSE 0
          END

          +

          CASE
            WHEN v.vehicle_type = t.vehicle_type THEN 15
            ELSE 0
          END

          +

          CASE
            WHEN v.fuel_type IS NOT NULL
             AND v.fuel_type = t.fuel_type THEN 5
            ELSE 0
          END

          +

          CASE
            WHEN v.transmission_type IS NOT NULL
             AND v.transmission_type = t.transmission_type THEN 5
            ELSE 0
          END

          +

          CASE
            WHEN t.price > 0
             AND ABS(v.price - t.price) / t.price <= 0.15 THEN 10
            ELSE 0
          END

          +

          CASE
            WHEN ABS(v.manufacture_year - t.manufacture_year) <= 2 THEN 5
            ELSE 0
          END

        ) AS similarity_score

      FROM marketplace.vehicles v

      CROSS JOIN target t

      LEFT JOIN marketplace.vehicle_images vi
        ON vi.vehicle_id = v.id
       AND vi.is_primary = true

      LEFT JOIN auth.dealer_profiles dp
        ON dp.user_id = v.dealer_id

      WHERE v.status = 'LIVE'
        AND v.id <> t.id

      ORDER BY similarity_score DESC, v.created_at DESC

      LIMIT $2
      `,
      [vehicleId, limit],
    );

    return rows.map((row) => ({
      id: row.id,
      vehicleType: row.vehicle_type,
      make: row.make,
      model: row.model,
      manufactureYear: row.manufacture_year,
      registrationYear: row.registration_year,
      price: parseFloat(row.price),
      mileage: row.mileage,
      fuelType: row.fuel_type,
      transmissionType: row.transmission_type,
      locationCity: row.location_city,
      locationDistrict: row.location_district,
      condition: row.condition,
      imageUrl: row.image_path,
      thumbnailUrl: row.thumbnail_path,
      dealerVerified: row.dealer_verified === true,
      similarityScore: Number(row.similarity_score),
    }));
  }
  async vehicleExists(
  vehicleId: string,
): Promise<boolean> {
  const rows: Array<{ exists: boolean }> =
    await this.dataSource.query(
      `
      SELECT EXISTS(
        SELECT 1
        FROM marketplace.vehicles
        WHERE id = $1
      ) AS exists
      `,
      [vehicleId],
    );

  return rows[0]?.exists === true;
}
}
