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
} from 'class-validator';
import { BadRequestException } from '@nestjs/common';
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
 * Runtime shape only — validated against KNOWN_SPEC_KEYS in the query
 * builder, not here. See the `specs` field below for why this is no longer
 * a class-validated nested DTO.
 */
export interface SpecFilterDto {
  key: string;
  value: string;
}

/**
 * Parses `?specs=body_type:SUV,engine_class:150cc` into SpecFilterDto[].
 *
 * Originally this was `specs[0][key]=x&specs[0][value]=y` validated via
 * @ValidateNested + @Type(() => SpecFilterDto) — a combination that is a
 * known-fragile interaction with ValidationPipe's whitelist:true:
 * whitelist stripping runs against the outer DTO's recognized properties
 * before/independently of the nested class-transformer instantiation
 * completing, so `specs[0].key`/`specs[0].value` got rejected as "should
 * not exist" even though the envelope (`specs` itself) was declared and
 * qs correctly parsed the bracket syntax into the right nested object.
 *
 * A flat "key:value,key:value" string sidesteps the whole class validator
 * nested-array code path — one scalar field, one Transform, no interaction
 * with whitelist's per-level property recognition.
 */
function parseSpecs(): (params: { value: unknown }) => SpecFilterDto[] | undefined {
  return ({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = Array.isArray(value) ? value.join(',') : String(value);
    const pairs = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    const specs: SpecFilterDto[] = [];
    for (const pair of pairs) {
      const colonIndex = pair.indexOf(':');
      if (colonIndex === -1) {
        throw new BadRequestException(
          `Malformed specs entry "${pair}" — expected "key:value"`,
        );
      }
      specs.push({
        key: pair.slice(0, colonIndex),
        value: pair.slice(colonIndex + 1),
      });
    }
    return specs.length > 0 ? specs : undefined;
  };
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

  // Accepts ?specs=body_type:SUV,seats:5 — see parseSpecs() above for why
  // this is a flat Transform rather than @ValidateNested + @Type.
  @IsOptional()
  @Transform(parseSpecs())
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
