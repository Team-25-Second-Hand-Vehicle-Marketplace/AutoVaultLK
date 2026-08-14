import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BuiltFilterQuery, buildFilterQuery } from '../filters/filter-query.builder';
import { buildOrderBy } from '../filters/sort-clause';
import { FilterSearchDto } from '../dto/filter-search.dto';
import {
  VehicleSearchResultDto,
  VehicleDetailDto,
  FacetBucketDto,
} from '../dto/filter-search-response.dto';

/**
 * Primary listing photo, or NULL when the dealer hasn't uploaded one.
 *
 * LEFT JOIN, never INNER: vehicle_images is empty in every environment right
 * now, and an inner join here would silently return zero results for every
 * search. idx_vehicle_images_one_primary (UNIQUE on vehicle_id WHERE
 * is_primary) guarantees at most one row per vehicle, so this cannot fan out
 * and inflate COUNT(*).
 *
 * COALESCE order is display-quality order: a processed/optimized render if
 * ETL produced one, otherwise the original upload.
 */
const IMAGE_JOIN = `
  LEFT JOIN marketplace.vehicle_images vi
    ON vi.vehicle_id = v.id AND vi.is_primary = true
`;

const IMAGE_COLUMNS = `
  COALESCE(vi.processed_path, vi.s3_path) AS image_path,
  vi.thumbnail_path AS thumbnail_path
`;

/**
 * Per-row dealer verification.
 *
 * Previously this was hardcoded to `dto.verifiedDealersOnly ?? false`, which
 * meant the "Verified Dealer" badge could only ever appear on a search that
 * had already filtered to verified dealers — i.e. exactly where it carried no
 * information — and every card on a normal search claimed the dealer was
 * unverified. This LEFT JOIN reports the real value on every row.
 *
 * Kept separate from the verifiedDealersOnly INNER JOIN below: this one must
 * never remove rows, so a vehicle whose dealer has no profile row still shows
 * up (as unverified) rather than vanishing.
 */
const DEALER_JOIN = `
  LEFT JOIN auth.dealer_profiles dpv ON dpv.user_id = v.dealer_id
`;

const DEALER_COLUMNS = `
  (dpv.verification_status = 'VERIFIED') AS dealer_verified
`;

const SELECT_COLUMNS = `
  v.id, v.vehicle_type, v.make, v.model, v.manufacture_year,
  v.registration_year, v.price, v.is_negotiable, v.mileage,
  v.fuel_type, v.transmission_type, v.location_city, v.location_district,
  v.specs, v.created_at, v.condition,
  COALESCE(v.registration_year, v.manufacture_year) AS effective_year,
  ${DEALER_COLUMNS},
  ${IMAGE_COLUMNS}
`;

interface VehicleRow {
  id: string;
  vehicle_type: string;
  make: string;
  model: string;
  manufacture_year: number;
  registration_year: number | null;
  effective_year: number;
  price: string;
  is_negotiable: boolean;
  mileage: number;
  fuel_type: string | null;
  transmission_type: string | null;
  location_city: string | null;
  location_district: string | null;
  condition: string | null;
  specs: Record<string, unknown>;
  created_at: Date;
  dealer_verified: boolean | null;
  image_path: string | null;
  thumbnail_path: string | null;
}

interface VehicleDetailRow extends VehicleRow {
  description: string | null;
  color: string | null;
  owners_count: number | null;
  engine_capacity_cc: number | null;
  dealer_id: string;
  dealer_company_name: string | null;
  dealer_city: string | null;
  dealer_contact_number: string | null;
  image_paths: string[] | null;
}

@Injectable()
export class VehicleSearchRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * verifiedDealersOnly is applied here, not in the query builder — it
   * changes FROM, not just WHERE, and the builder is deliberately scoped to
   * vehicles-table-only clauses so it stays a pure, testable function.
   *
   * `extraJoins` carries the display-only joins (image, dealer verification)
   * that SELECT needs but COUNT does not — counting with them attached is
   * wasted work, and they must never change the row count.
   */
  private buildFromAndWhere(
    built: BuiltFilterQuery,
    verifiedDealersOnly?: boolean,
    extraJoins = '',
  ) {
    const base = `marketplace.vehicles v${extraJoins}`;
    if (!verifiedDealersOnly) {
      return { from: base, where: built.whereSql, params: built.params };
    }
    const params = [...built.params];
    const dealerParamIndex = params.length + 1;
    params.push('VERIFIED');
    return {
      from: `${base}
             JOIN auth.dealer_profiles dp ON dp.user_id = v.dealer_id`,
      where: `${built.whereSql} AND dp.verification_status = $${dealerParamIndex}`,
      params,
    };
  }

  async search(
    built: BuiltFilterQuery,
    dto: FilterSearchDto,
    queryEmbedding?: number[],
  ): Promise<VehicleSearchResultDto[]> {
    const { from, where, params } = this.buildFromAndWhere(
      built,
      dto.verifiedDealersOnly,
      `${DEALER_JOIN}${IMAGE_JOIN}`,
    );
    const limit = dto.limit ?? 20;
    const offset = ((dto.page ?? 1) - 1) * limit;

    const queryParams = [...params];
    const sort = buildOrderBy(dto.sort, queryParams, {
      keyword: dto.q,
      queryEmbedding,
    });
    queryParams.push(limit, offset);
    const limitIdx = queryParams.length - 1;
    const offsetIdx = queryParams.length;

    const rows: VehicleRow[] = await this.dataSource.query(
      `SELECT ${SELECT_COLUMNS}
       FROM ${from}
       WHERE ${where}
       ORDER BY ${sort}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      queryParams,
    );

    return rows.map((row) => this.mapRow(row));
  }

  async count(built: BuiltFilterQuery, verifiedDealersOnly?: boolean): Promise<number> {
    const { from, where, params } = this.buildFromAndWhere(built, verifiedDealersOnly);
    const [{ count }] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM ${from} WHERE ${where}`,
      params,
    );
    return parseInt(count, 10);
  }

  /**
   * Per-dimension counts for the sidebar ("SUV (14)").
   *
   * Each dimension is counted against every filter EXCEPT its own — standard
   * faceted-search semantics. Counting a dimension against its own filter
   * makes the facet list collapse to just the selected value the moment a
   * buyer clicks anything ("PETROL (34)" and nothing else), which destroys
   * the affordance the counts exist to provide: "if I also picked DIESEL,
   * how many more would I see?"
   *
   * That requires rebuilding the WHERE clause per dimension from a modified
   * DTO, so this takes the DTO rather than the prebuilt query.
   *
   * The five queries are independent, so they run concurrently.
   */
  async facets(dto: FilterSearchDto): Promise<Record<string, FacetBucketDto[]>> {
    const dimensions: Array<{
      key: keyof FilterSearchDto;
      column: string;
    }> = [
      { key: 'vehicleType', column: 'v.vehicle_type' },
      { key: 'make', column: 'v.make' },
      { key: 'fuelType', column: 'v.fuel_type' },
      { key: 'transmissionType', column: 'v.transmission_type' },
      { key: 'condition', column: 'v.condition' },
    ];

    const entries = await Promise.all(
      dimensions.map(async ({ key, column }) => {
        // Drop this dimension's own filter before building its count query.
        const scopedDto = { ...dto, [key]: undefined } as FilterSearchDto;
        const scopedBuilt = buildFilterQuery(scopedDto);
        const { from, where, params } = this.buildFromAndWhere(
          scopedBuilt,
          dto.verifiedDealersOnly,
        );

        const rows: Array<{ value: string; count: string }> = await this.dataSource.query(
          `SELECT ${column} AS value, COUNT(*) AS count
           FROM ${from}
           WHERE ${where} AND ${column} IS NOT NULL
           GROUP BY ${column}
           ORDER BY count DESC, value ASC`,
          params,
        );

        return [
          key as string,
          rows.map((r) => ({ value: r.value, count: parseInt(r.count, 10) })),
        ] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  /**
   * Single vehicle for the detail page. Gated on the same SEARCHABLE_STATUS
   * as search itself — a direct link to a DRAFT/SOLD/ARCHIVED listing must
   * 404 rather than expose a row search would never return.
   *
   * Returns null (not a throw) so the controller owns the HTTP shape.
   */
  async findById(id: string): Promise<VehicleDetailDto | null> {
    const rows: VehicleDetailRow[] = await this.dataSource.query(
      `SELECT ${SELECT_COLUMNS},
              v.description, v.color, v.owners_count, v.engine_capacity_cc,
              v.dealer_id,
              dpv.company_name   AS dealer_company_name,
              dpv.city           AS dealer_city,
              dpv.contact_number AS dealer_contact_number,
              (
                SELECT array_agg(COALESCE(i.processed_path, i.s3_path)
                                 ORDER BY i.is_primary DESC, i.display_order ASC)
                FROM marketplace.vehicle_images i
                WHERE i.vehicle_id = v.id
              ) AS image_paths
       FROM marketplace.vehicles v${DEALER_JOIN}${IMAGE_JOIN}
       WHERE v.id = $1 AND v.status = $2`,
      [id, 'LIVE'],
    );

    if (rows.length === 0) return null;
    const row = rows[0];

    return {
      ...this.mapRow(row),
      description: row.description,
      color: row.color,
      ownersCount: row.owners_count,
      engineCapacityCc: row.engine_capacity_cc,
      images: row.image_paths ?? [],
      dealer: {
        id: row.dealer_id,
        companyName: row.dealer_company_name,
        city: row.dealer_city,
        contactNumber: row.dealer_contact_number,
        verified: row.dealer_verified === true,
      },
    };
  }

  private mapRow(row: VehicleRow): VehicleSearchResultDto {
    return {
      id: row.id,
      vehicleType: row.vehicle_type as VehicleSearchResultDto['vehicleType'],
      make: row.make,
      model: row.model,
      condition: row.condition,
      manufactureYear: row.manufacture_year,
      registrationYear: row.registration_year,
      effectiveYear: row.effective_year,
      price: parseFloat(row.price),
      isNegotiable: row.is_negotiable,
      mileage: row.mileage,
      fuelType: row.fuel_type,
      transmissionType: row.transmission_type,
      locationCity: row.location_city,
      locationDistrict: row.location_district,
      specs: row.specs,
      // LEFT JOIN yields NULL for a vehicle whose dealer has no profile row;
      // that is "not verified", not "unknown", for badge purposes.
      dealerVerified: row.dealer_verified === true,
      imageUrl: row.image_path,
      thumbnailUrl: row.thumbnail_path,
      createdAt: row.created_at,
    };
  }
}
