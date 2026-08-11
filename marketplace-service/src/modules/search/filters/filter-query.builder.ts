import { BadRequestException } from '@nestjs/common';
import { FilterSearchDto, SpecFilterDto } from '../dto/filter-search.dto';
import { KNOWN_SPEC_KEYS, KnownSpecKey } from '../constants/known-spec-keys.constants';
import { SEARCHABLE_STATUS } from '../constants/vehicle-attributes.constants';

export interface BuiltFilterQuery {
  whereSql: string; // e.g. "v.status = $1 AND v.price <= $2"
  params: unknown[];
  // Which top-level filter categories were present, in application order.
  // Used by the relaxation ladder (§8) to know what it's allowed to drop.
  appliedFilterKeys: string[];
}

const COLUMN_ARRAY_FILTERS: Array<{
  dtoKey: keyof FilterSearchDto;
  column: string;
}> = [
  { dtoKey: 'vehicleType', column: 'v.vehicle_type' },
  { dtoKey: 'make', column: 'v.make' },
  { dtoKey: 'model', column: 'v.model' },
  { dtoKey: 'condition', column: 'v.condition' },
  { dtoKey: 'fuelType', column: 'v.fuel_type' },
  { dtoKey: 'transmissionType', column: 'v.transmission_type' },
  { dtoKey: 'color', column: 'v.color' },
  { dtoKey: 'locationCity', column: 'v.location_city' },
  { dtoKey: 'locationDistrict', column: 'v.location_district' },
];

/**
 * Validates one spec filter against KNOWN_SPEC_KEYS and returns the SQL
 * fragment for it. Throws BadRequestException on an unknown key or a value
 * that doesn't fit the key's declared type — the whitelist discipline the
 * design doc applies to LLM output (§6.6), applied here to buyer input.
 *
 * Equality on enum/bool specs uses `@>` containment (Decision 2) so it hits
 * idx_vehicles_specs. Range-shaped int specs (seats, load_capacity_kg) use
 * the cast form, which is why migration 19000 added expression indexes for
 * them specifically — @> cannot express a range.
 */
import { SpecKeyDefinition } from '../constants/known-spec-keys.constants';

function buildSpecClause(
  filter: SpecFilterDto,
  paramIndex: () => number,
  params: unknown[],
): string {
  const def: SpecKeyDefinition | undefined = KNOWN_SPEC_KEYS[filter.key as KnownSpecKey];
  if (!def) {
    throw new BadRequestException(`Unknown spec filter key: "${filter.key}"`);
  }

  if (def.type === 'enum') {
    if (!(def.values as readonly string[]).includes(filter.value)) {

      throw new BadRequestException(
        `Invalid value "${filter.value}" for spec "${filter.key}". Allowed: ${def.values.join(', ')}`,
      );
    }
    const p = paramIndex();
    params.push(JSON.stringify({ [filter.key]: filter.value }));
    return `v.specs @> $${p}::jsonb`;
  }

  if (def.type === 'bool') {
    if (filter.value !== 'true' && filter.value !== 'false') {
      throw new BadRequestException(`Spec "${filter.key}" must be "true" or "false"`);
    }
    const p = paramIndex();
    params.push(JSON.stringify({ [filter.key]: filter.value === 'true' }));
    return `v.specs @> $${p}::jsonb`;
  }

  // int: equality via cast, bounds-checked against the key's declared range.
  const n = Number(filter.value);
  if (!Number.isInteger(n) || n < def.min || n > def.max) {
    throw new BadRequestException(
      `Spec "${filter.key}" must be an integer between ${def.min} and ${def.max}`,
    );
  }
  const p = paramIndex();
  params.push(n);
  return `(v.specs->>'${filter.key}')::int = $${p}`;
}

export function buildFilterQuery(dto: FilterSearchDto): BuiltFilterQuery {
  const params: unknown[] = [];
  let paramCount = 0;
  const nextParam = () => ++paramCount;

  const clauses: string[] = [];
  const appliedFilterKeys: string[] = [];

  // Always leads. Every index on this table is composited with status
  // first (migrations 14000, 19000) — design doc §10: every buyer-facing
  // query gates on status = 'LIVE' before anything else.
  params.push(SEARCHABLE_STATUS);
  clauses.push(`v.status = $${nextParam()}`);

  for (const { dtoKey, column } of COLUMN_ARRAY_FILTERS) {
    const values = dto[dtoKey] as string[] | undefined;
    if (values && values.length > 0) {
      const p = nextParam();
      params.push(values);
      clauses.push(`${column} = ANY($${p}::text[])`);
      appliedFilterKeys.push(dtoKey);
    }
  }

  if (dto.minPrice !== undefined) {
    params.push(dto.minPrice);
    clauses.push(`v.price >= $${nextParam()}`);
    appliedFilterKeys.push('minPrice');
  }
  if (dto.maxPrice !== undefined) {
    params.push(dto.maxPrice);
    clauses.push(`v.price <= $${nextParam()}`);
    appliedFilterKeys.push('maxPrice');
  }

  // Decision 3: COALESCE, never registration_year alone. registration_year
  // is nullable because dealers omit it; filtering on it directly would
  // make those listings invisible with no error (verified: 42 vs 65 rows
  // on the seeded data — see Phase 0.5). manufacture_year is NOT NULL, so
  // every vehicle always has a value to compare.
  //
  // hasRegistrationYear is the opt-in escape hatch for a buyer who wants
  // only confirmed registration years — off by default.
  const yearExpr = dto.hasRegistrationYear
    ? 'v.registration_year'
    : 'COALESCE(v.registration_year, v.manufacture_year)';
  if (dto.hasRegistrationYear) {
    clauses.push('v.registration_year IS NOT NULL');
  }
  if (dto.minYear !== undefined) {
    params.push(dto.minYear);
    clauses.push(`${yearExpr} >= $${nextParam()}`);
    appliedFilterKeys.push('minYear');
  }
  if (dto.maxYear !== undefined) {
    params.push(dto.maxYear);
    clauses.push(`${yearExpr} <= $${nextParam()}`);
    appliedFilterKeys.push('maxYear');
  }

  if (dto.minMileage !== undefined) {
    params.push(dto.minMileage);
    clauses.push(`v.mileage >= $${nextParam()}`);
    appliedFilterKeys.push('minMileage');
  }
  if (dto.maxMileage !== undefined) {
    params.push(dto.maxMileage);
    clauses.push(`v.mileage <= $${nextParam()}`);
    appliedFilterKeys.push('maxMileage');
  }

  if (dto.maxOwners !== undefined) {
    params.push(dto.maxOwners);
    clauses.push(`v.owners_count <= $${nextParam()}`);
    appliedFilterKeys.push('maxOwners');
  }

  if (dto.isNegotiable !== undefined) {
    params.push(dto.isNegotiable);
    clauses.push(`v.is_negotiable = $${nextParam()}`);
    appliedFilterKeys.push('isNegotiable');
  }

  if (dto.specs && dto.specs.length > 0) {
    for (const spec of dto.specs) {
      clauses.push(buildSpecClause(spec, nextParam, params));
    }
    appliedFilterKeys.push('specs');
  }

  // D5 keyword layer — the tsvector path (design doc §11.5). plainto_tsquery
  // handles user punctuation/casing safely; never string-concatenated.
  if (dto.q && dto.q.trim().length > 0) {
    params.push(dto.q.trim());
    clauses.push(`v.search_vector @@ plainto_tsquery('english', $${nextParam()})`);
    appliedFilterKeys.push('q');
  }

  return {
    whereSql: clauses.join(' AND '),
    params,
    appliedFilterKeys,
  };
}
