import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  CONDITIONS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  VEHICLE_TYPES,
} from '../../search/constants/vehicle-attributes.constants';

function enumFrom<T extends string>(values: readonly T[]): Record<T, T> {
  return Object.freeze(
    Object.fromEntries(values.map((value) => [value, value])),
  ) as Record<T, T>;
}

export const VehicleTypeDto = enumFrom(VEHICLE_TYPES);
export type VehicleTypeDto = (typeof VEHICLE_TYPES)[number];

export const FuelTypeDto = enumFrom(FUEL_TYPES);
export type FuelTypeDto = (typeof FUEL_TYPES)[number];

export const TransmissionTypeDto = enumFrom(TRANSMISSION_TYPES);
export type TransmissionTypeDto = (typeof TRANSMISSION_TYPES)[number];

export const ConditionDto = enumFrom(CONDITIONS);
export type ConditionDto = (typeof CONDITIONS)[number];

/** Manual dealer create: DRAFT or LIVE. ETL/bulk uses PENDING_REVIEW via service default. */
export enum ManualListingStatusDto {
  DRAFT = 'DRAFT',
  LIVE = 'LIVE',
}

export class CreateListingDto {
  /**
   * Ignored on write - the owner is taken from the verified JWT (FR-13/FR-58).
   * Kept optional so existing clients that still send it are not rejected.
   */
  @IsOptional()
  @IsUUID()
  dealerId?: string;

  // Required: it decides which category-specific specs apply, so it is never
  // defaulted. (UpdateListingDto makes every field optional, so a PATCH can
  // still leave it alone.)
  @IsEnum(VehicleTypeDto)
  vehicleType: VehicleTypeDto;

  @IsString()
  @IsNotEmpty()
  make: string;

  @IsString()
  @IsNotEmpty()
  model: string;

  @IsOptional()
  @IsEnum(ConditionDto)
  condition?: ConditionDto;

  @IsInt()
  @Min(1980)
  @Max(new Date().getFullYear() + 1)
  manufactureYear: number;

  @IsOptional()
  @IsInt()
  @Min(1980)
  @Max(new Date().getFullYear() + 1)
  registrationYear?: number;

  @IsNumber()
  @IsPositive()
  price: number;

  @IsInt()
  @Min(0)
  mileage: number;

  @IsEnum(FuelTypeDto)
  fuelType: FuelTypeDto;

  @IsEnum(TransmissionTypeDto)
  transmissionType: TransmissionTypeDto;

  /*
   * The four fields below are required because the bulk-upload CSV requires
   * them (`REQUIRED_COLUMNS` in ingestion-service's csv-contract.ts: color,
   * engine_capacity_cc, owners_count, location_district). A manual listing
   * that could omit them would be thinner than a bulk one and would silently
   * drop out of the colour / district / owners search filters.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  color: string;

  @IsInt()
  @Min(50)
  @Max(20_000)
  engineCapacityCc: number;

  @IsInt()
  @Min(0)
  @Max(20)
  ownersCount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  locationDistrict: string;

  // Optional CSV columns (KNOWN_COLUMNS minus REQUIRED_COLUMNS). Spec columns
  // (seats, sunroof, stroke_type, ...) travel in `specs` below, exactly as the
  // ETL's enrich stage writes them.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  locationCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  chassisNumber?: string;

  @IsOptional()
  @IsBoolean()
  isNegotiable?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ManualListingStatusDto)
  status?: ManualListingStatusDto;

  @IsOptional()
  @IsObject()
  specs?: Record<string, unknown>;
}
