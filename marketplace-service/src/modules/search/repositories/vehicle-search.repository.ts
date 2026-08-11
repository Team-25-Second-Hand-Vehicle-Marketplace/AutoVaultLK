import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BuiltFilterQuery } from '../filters/filter-query.builder';
import { FilterSearchDto } from '../dto/filter-search.dto';
import { SortOption } from '../constants/vehicle-attributes.constants';
import { VehicleSearchResultDto, FacetBucketDto } from '../dto/filter-search-response.dto';

const SORT_SQL: Record<SortOption, string> = {
  relevance: 'v.created_at DESC', // no semantic_text in filter search — falls back to recency, design doc §9
  price_asc: 'v.price ASC',
  price_desc: 'v.price DESC',
  year_desc: 'COALESCE(v.registration_year, v.manufacture_year) DESC',
  mileage_asc: 'v.mileage ASC',
  newest: 'v.created_at DESC',
};

const SELECT_COLUMNS = `
  v.id, v.vehicle_type, v.make, v.model, v.manufacture_year,
  v.registration_year, v.price, v.is_negotiable, v.mileage,
  v.fuel_type, v.transmission_type, v.location_city, v.location_district,
  v.specs, v.created_at,
  COALESCE(v.registration_year, v.manufacture_year) AS effective_year
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
  specs: Record<string, unknown>;
  created_at: Date;
}

@Injectable()
export class VehicleSearchRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * verifiedDealersOnly is applied here, not in the query builder — it
   * changes FROM, not just WHERE, and the builder is deliberately scoped to
   * vehicles-table-only clauses (Phase 2A comment). One JOIN, added only
   * when asked for, keeps the common (unverified) path index-clean.
   */
  private buildFromAndWhere(built: BuiltFilterQuery, verifiedDealersOnly?: boolean) {
    if (!verifiedDealersOnly) {
      return { from: 'marketplace.vehicles v', where: built.whereSql, params: built.params };
    }
    const params = [...built.params];
    const dealerParamIndex = params.length + 1;
    params.push('VERIFIED');
    return {
      from: `marketplace.vehicles v
             JOIN auth.dealer_profiles dp ON dp.user_id = v.dealer_id`,
      where: `${built.whereSql} AND dp.verification_status = $${dealerParamIndex}`,
      params,
    };
  }

  async search(
    built: BuiltFilterQuery,
    dto: FilterSearchDto,
  ): Promise<VehicleSearchResultDto[]> {
    const { from, where, params } = this.buildFromAndWhere(built, dto.verifiedDealersOnly);
    const sort = SORT_SQL[dto.sort ?? 'relevance'];
    const limit = dto.limit ?? 20;
    const offset = ((dto.page ?? 1) - 1) * limit;

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const rows: VehicleRow[] = await this.dataSource.query(
      `SELECT ${SELECT_COLUMNS}
       FROM ${from}
       WHERE ${where}
       ORDER BY ${sort}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset],
    );

    // dealerVerified: when verifiedDealersOnly was set, every returned row
    // is verified by construction of the JOIN above. When it wasn't set, we
    // don't know per-row verification without an unconditional second join
    // — deferred; false is the honest "unknown/not filtered" default for v1.
    const dealerVerified = dto.verifiedDealersOnly ?? false;
    return rows.map((row) => this.mapRow(row, dealerVerified));
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
   * Per-dimension counts for the sidebar ("SUV (14)"). Runs one GROUP BY
   * query per dimension rather than a single multi-dimensional query —
   * simpler to reason about, and facet queries are cheap relative to the
   * main search on this table size.
   */
  async facets(
    built: BuiltFilterQuery,
    verifiedDealersOnly?: boolean,
  ): Promise<Record<string, FacetBucketDto[]>> {
    const { from, where, params } = this.buildFromAndWhere(built, verifiedDealersOnly);
    const dimensions: Array<{ key: string; column: string }> = [
      { key: 'vehicleType', column: 'v.vehicle_type' },
      { key: 'make', column: 'v.make' },
      { key: 'fuelType', column: 'v.fuel_type' },
      { key: 'transmissionType', column: 'v.transmission_type' },
      { key: 'condition', column: 'v.condition' },
    ];

    const result: Record<string, FacetBucketDto[]> = {};
    for (const { key, column } of dimensions) {
      const rows: Array<{ value: string; count: string }> = await this.dataSource.query(
        `SELECT ${column} AS value, COUNT(*) AS count
         FROM ${from}
         WHERE ${where} AND ${column} IS NOT NULL
         GROUP BY ${column}
         ORDER BY count DESC`,
        params,
      );
      result[key] = rows.map((r) => ({ value: r.value, count: parseInt(r.count, 10) }));
    }
    return result;
  }

  private mapRow(row: VehicleRow, dealerVerified: boolean): VehicleSearchResultDto {
    return {
      id: row.id,
      vehicleType: row.vehicle_type as VehicleSearchResultDto['vehicleType'],
      make: row.make,
      model: row.model,
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
      dealerVerified,
      createdAt: row.created_at,
    };
  }
}
