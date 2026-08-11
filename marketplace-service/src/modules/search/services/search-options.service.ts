import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CONDITIONS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  VEHICLE_TYPES,
} from '../constants/vehicle-attributes.constants';
import { KNOWN_SPEC_KEYS } from '../constants/known-spec-keys.constants';
import { SearchOptionsResponseDto, MakeOptionDto } from '../dto/search-options-response.dto';

interface DictRow {
  id: string;
  parent_id: string | null;
  canonical_value: string;
}

@Injectable()
export class SearchOptionsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getOptions(vehicleType?: string): Promise<SearchOptionsResponseDto> {
    const makes = await this.getMakesWithModels(vehicleType);

    return {
      vehicleTypes: VEHICLE_TYPES,
      conditions: CONDITIONS,
      fuelTypes: FUEL_TYPES,
      transmissionTypes: TRANSMISSION_TYPES,
      bodyTypes: [...KNOWN_SPEC_KEYS.body_type.values],
      makes,
    };
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
