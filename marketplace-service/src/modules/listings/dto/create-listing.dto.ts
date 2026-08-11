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
  Min,
} from 'class-validator';

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

export class CreateListingDto {
  @IsUUID()
  dealerId: string;

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

  @IsOptional()
  @IsBoolean()
  isNegotiable?: boolean;

  @IsInt()
  @Min(0)
  mileage: number;

  @IsOptional()
  @IsEnum(FuelTypeDto)
  fuelType?: FuelTypeDto;

  @IsOptional()
  @IsEnum(TransmissionTypeDto)
  transmissionType?: TransmissionTypeDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  engineCapacityCc?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  ownersCount?: number;

  @IsOptional()
  @IsString()
  locationCity?: string;

  @IsOptional()
  @IsString()
  locationDistrict?: string;

  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  chassisNumber?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  specs?: Record<string, unknown>;
}
