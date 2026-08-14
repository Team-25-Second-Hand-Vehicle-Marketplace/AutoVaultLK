import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CONDITIONS,
  FUEL_TYPES,
  SEARCHABLE_STATUS,
  TRANSMISSION_TYPES,
  VEHICLE_TYPES,
} from '../constants/vehicle-attributes.constants';
import { KNOWN_SPEC_KEYS } from '../constants/known-spec-keys.constants';
import {
  SearchOptionsResponseDto,
  MakeOptionDto,
  MarketplaceStatsDto,
} from '../dto/search-options-response.dto';

interface DictRow {
  id: string;
  parent_id: string | null;
  canonical_value: string;
}

/**
 * vehicle_dictionaries changes when someone runs a seed or an admin adds a
 * make — not during a browsing session. Without this cache every sidebar
 * mount (and every vehicle-type change) re-runs two dictionary queries to
 * return bytes that are almost always identical.
 *
 * Keyed by vehicle type because the make list is type-scoped. Deliberately a
 * plain in-process Map: this service has no Redis, the payload is a few KB
 * per key across at most 12 keys, and a stale entry's worst case is a newly
 * seeded make missing from a dropdown for a few minutes.
 */
const OPTIONS_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class SearchOptionsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private readonly cache = new Map<string, { value: SearchOptionsResponseDto; expiresAt: number }>();
  private statsCache: { value: MarketplaceStatsDto; expiresAt: number } | null = null;

  async getOptions(vehicleType?: string): Promise<SearchOptionsResponseDto> {
    const cacheKey = vehicleType ?? '__all__';
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const options = await this.loadOptions(vehicleType);
    this.cache.set(cacheKey, { value: options, expiresAt: Date.now() + OPTIONS_CACHE_TTL_MS });
    return options;
  }

  private async loadOptions(vehicleType?: string): Promise<SearchOptionsResponseDto> {
    const [makes, districts] = await Promise.all([
      this.getMakesWithModels(vehicleType),
      this.getDistricts(),
    ]);

    return {
      vehicleTypes: VEHICLE_TYPES,
      conditions: CONDITIONS,
      fuelTypes: FUEL_TYPES,
      transmissionTypes: TRANSMISSION_TYPES,
      bodyTypes: [...KNOWN_SPEC_KEYS.body_type.values],
      makes,
      districts,
    };
  }

  /**
   * Landing-page headline figures, all computed from live data.
   *
   * Shares the same cache as getOptions: these counts move only when
   * inventory changes, and the landing page is the most-hit route in the app.
   */
  async getStats(): Promise<MarketplaceStatsDto> {
    const cached = this.statsCache;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // One round trip per shape of question, run concurrently.
    const [totals, categories, topMakes] = await Promise.all([
      this.dataSource.query(
        `SELECT
           COUNT(*)                                   AS vehicle_count,
           COUNT(DISTINCT v.dealer_id)                AS dealer_count,
           COUNT(DISTINCT v.make)                     AS make_count,
           COUNT(DISTINCT v.dealer_id)
             FILTER (WHERE dp.verification_status = 'VERIFIED') AS verified_dealer_count
         FROM marketplace.vehicles v
         LEFT JOIN auth.dealer_profiles dp ON dp.user_id = v.dealer_id
         WHERE v.status = $1`,
        [SEARCHABLE_STATUS],
      ),
      this.dataSource.query(
        `SELECT vehicle_type, COUNT(*) AS count
         FROM marketplace.vehicles
         WHERE status = $1
         GROUP BY vehicle_type
         ORDER BY count DESC`,
        [SEARCHABLE_STATUS],
      ),
      this.dataSource.query(
        `SELECT make, COUNT(*) AS count
         FROM marketplace.vehicles
         WHERE status = $1
         GROUP BY make
         ORDER BY count DESC, make ASC
         LIMIT 12`,
        [SEARCHABLE_STATUS],
      ),
    ]);

    const row = totals[0] ?? {};
    const stats: MarketplaceStatsDto = {
      vehicleCount: parseInt(row.vehicle_count ?? '0', 10),
      dealerCount: parseInt(row.dealer_count ?? '0', 10),
      verifiedDealerCount: parseInt(row.verified_dealer_count ?? '0', 10),
      makeCount: parseInt(row.make_count ?? '0', 10),
      categories: categories.map((c: { vehicle_type: string; count: string }) => ({
        vehicleType: c.vehicle_type,
        count: parseInt(c.count, 10),
      })),
      topMakes: topMakes.map((m: { make: string; count: string }) => ({
        make: m.make,
        count: parseInt(m.count, 10),
      })),
    };

    this.statsCache = { value: stats, expiresAt: Date.now() + OPTIONS_CACHE_TTL_MS };
    return stats;
  }

  /**
   * Districts that actually have live inventory, for the location filter.
   *
   * Read from vehicles rather than a hardcoded list of Sri Lanka's 25
   * districts: offering a buyer a district with nothing in it is a
   * guaranteed empty result set, and the dictionary table has no
   * DISTRICT entries to read instead.
   */
  private async getDistricts(): Promise<string[]> {
    const rows: Array<{ location_district: string }> = await this.dataSource.query(
      `SELECT DISTINCT location_district
       FROM marketplace.vehicles
       WHERE status = $1 AND location_district IS NOT NULL
       ORDER BY location_district`,
      [SEARCHABLE_STATUS],
    );
    return rows.map((r) => r.location_district);
  }

  /**
   * Type-scoped make/model dropdown — the reason vehicle_types was added to
   * vehicle_dictionaries in Phase 0.3b. Without the @> filter, a buyer
   * browsing BIKE would see Toyota in the Make list.
   */
  private async getMakesWithModels(vehicleType?: string): Promise<MakeOptionDto[]> {
    const makeParams: unknown[] = [];
    let makeTypeFilter = '';
    if (vehicleType) {
      makeParams.push([vehicleType]);
      makeTypeFilter = `AND vehicle_types @> $1::text[]`;
    }

    const makeRows: DictRow[] = await this.dataSource.query(
      `SELECT id, parent_id, canonical_value
       FROM marketplace.vehicle_dictionaries
       WHERE dictionary_type = 'MAKE' AND is_active = true ${makeTypeFilter}
       ORDER BY canonical_value`,
      makeParams,
    );

    if (makeRows.length === 0) return [];

    const makeIds = makeRows.map((m) => m.id);
    const modelParams: unknown[] = [makeIds];
    let modelTypeFilter = '';
    if (vehicleType) {
      modelParams.push([vehicleType]);
      modelTypeFilter = `AND vehicle_types @> $2::text[]`;
    }

    const modelRows: DictRow[] = await this.dataSource.query(
      `SELECT id, parent_id, canonical_value
       FROM marketplace.vehicle_dictionaries
       WHERE dictionary_type = 'MODEL' AND is_active = true
         AND parent_id = ANY($1::uuid[]) ${modelTypeFilter}
       ORDER BY canonical_value`,
      modelParams,
    );

    const modelsByMake = new Map<string, { id: string; name: string }[]>();
    for (const model of modelRows) {
      const list = modelsByMake.get(model.parent_id!) ?? [];
      list.push({ id: model.id, name: model.canonical_value });
      modelsByMake.set(model.parent_id!, list);
    }

    return makeRows.map((make) => ({
      id: make.id,
      name: make.canonical_value,
      models: modelsByMake.get(make.id) ?? [],
    }));
  }
}
