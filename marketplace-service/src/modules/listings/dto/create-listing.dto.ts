import {
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
  Min,
} from 'class-validator';

import {
  CONDITIONS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  VEHICLE_TYPES,
} from '../../search/constants/vehicle-attributes.constants';

/**
 * The accepted vocabularies, derived from the canonical lists rather than
 * restated.
 *
 * They used to be hand-written enums here, and VehicleTypeDto fell five values
 * behind: migration 20000 extended vehicle_type to eleven values and updated
 * the entity, the ingestion write-entity and the search constants, but not this
 * file. The result was a DTO that rejected THREE_WHEELER, LORRY, PICKUP,
 * TRACTOR and HEAVY_MACHINERY — types the database accepts, the search facets
 * offer, and the ETL writes every day — so a dealer could bulk-upload a lorry
 * but not create one by hand.
 *
 * Deriving them means the next extension cannot repeat that: there is one list,
 * in `search/constants/vehicle-attributes.constants.ts`, and this follows it.
 *
 * `@IsEnum` takes any object whose values are the permitted set, so a frozen
 * map built from the array validates exactly as a hand-written enum did.
 */
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
   * Ignored on write — the owner is taken from the verified JWT (FR-13/FR-58).
   * Kept optional so existing clients that still send it are not rejected.
   */
  @IsOptional()
  @IsUUID()
  dealerId?: string;

  @IsOptional()
  @IsEnum(VehicleTypeDto)
  vehicleType?: VehicleTypeDto;

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
