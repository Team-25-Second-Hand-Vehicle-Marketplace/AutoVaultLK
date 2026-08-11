import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CONDITIONS,
  FUEL_TYPES,
  MAX_PAGE_SIZE,
  SORT_OPTIONS,
  TRANSMISSION_TYPES,
  VEHICLE_TYPES,
} from '../constants/vehicle-attributes.constants';
import type {
  ConditionValue,
  FuelTypeValue,
  SortOption,
  TransmissionTypeValue,
  VehicleTypeValue,
} from '../constants/vehicle-attributes.constants';

import { KNOWN_SPEC_KEY_NAMES } from '../constants/known-spec-keys.constants';

// Accepts ?fuelType=PETROL,DIESEL as well as repeated ?fuelType=PETROL&fuelType=DIESEL.
function toArray(): (params: { value: unknown }) => string[] | undefined {
  return ({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value;
    return String(value)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  };
}

/**
 * One key/value pair inside specs, e.g. { key: "seats", value: "5" }.
 * Validated at runtime against KNOWN_SPEC_KEYS in the query builder — class
 * validators alone cannot express "value's shape depends on key's value",
 * so this DTO only enforces the envelope; SpecFilterValidator (Phase 2A)
 * enforces the whitelist and per-key type/range.
 */
export class SpecFilterDto {
  @IsString()
  key: string;

  @IsString()
  value: string;
}

export class FilterSearchDto {
  // ---- Column filters (multi-value) ----

  @IsOptional()
  @IsArray()
  @IsIn(VEHICLE_TYPES, { each: true })
  @Transform(toArray())
  vehicleType?: VehicleTypeValue[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray())
  make?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray())
  model?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(CONDITIONS, { each: true })
  @Transform(toArray())
  condition?: ConditionValue[];

  @IsOptional()
  @IsArray()
  @IsIn(FUEL_TYPES, { each: true })
  @Transform(toArray())
  fuelType?: FuelTypeValue[];

  @IsOptional()
  @IsArray()
  @IsIn(TRANSMISSION_TYPES, { each: true })
  @Transform(toArray())
  transmissionType?: TransmissionTypeValue[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray())
  color?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray())
  locationCity?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray())
  locationDistrict?: string[];

  // ---- Ranges ----

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  // Applies to COALESCE(registration_year, manufacture_year) — Decision 3.
  // Never registration_year alone; see filter-query.builder.ts.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1980)
  minYear?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Max(2100)
  maxYear?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minMileage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxMileage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxOwners?: number;

  // ---- Booleans ----

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isNegotiable?: boolean;

  // Opt-in strictness: only rows with a real registration_year (not a
  // manufacture_year fallback). Off by default — the whole point of
  // Decision 3 is that omitting this filter must not hide anything.
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasRegistrationYear?: boolean;

  // D5: join against auth.dealer_profiles.verification_status = 'VERIFIED'.
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  verifiedDealersOnly?: boolean;

  // ---- Specs (JSONB) ----

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpecFilterDto)
  specs?: SpecFilterDto[];

  // ---- Keyword layer (D5 — the tsvector path, §11.5 of the design doc) ----

  @IsOptional()
  @IsString()
  q?: string;

  // ---- Control ----

  @IsOptional()
  @IsIn(SORT_OPTIONS)
  sort?: SortOption;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  facets?: boolean;
}

// Re-exported so the query builder and its tests don't need to know the
// spec-key whitelist lives in a different file.
export { KNOWN_SPEC_KEY_NAMES };
