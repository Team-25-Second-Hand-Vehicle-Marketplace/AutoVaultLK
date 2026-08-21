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

export enum FuelTypeDto {
  PETROL = 'PETROL',
  DIESEL = 'DIESEL',
  HYBRID = 'HYBRID',
  ELECTRIC = 'ELECTRIC',
  CNG = 'CNG',
}

export enum TransmissionTypeDto {
  MANUAL = 'MANUAL',
  AUTOMATIC = 'AUTOMATIC',
  CVT = 'CVT',
  SEMI_AUTOMATIC = 'SEMI_AUTOMATIC',
}

export enum VehicleTypeDto {
  CAR = 'CAR',
  BIKE = 'BIKE',
  VAN = 'VAN',
  TRUCK = 'TRUCK',
  SUV = 'SUV',
  BUS = 'BUS',
}

export enum ConditionDto {
  NEW = 'NEW',
  USED = 'USED',
  RECONDITIONED = 'RECONDITIONED',
}

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
