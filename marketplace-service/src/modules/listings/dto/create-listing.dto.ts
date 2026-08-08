import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';

export enum FuelType {
  PETROL = 'Petrol',
  DIESEL = 'Diesel',
  HYBRID = 'Hybrid',
  ELECTRIC = 'Electric',
}

export enum TransmissionType {
  MANUAL = 'Manual',
  AUTOMATIC = 'Automatic',
}

export class CreateListingDto {
  @IsInt()
  @IsPositive()
  dealerId: number;

  @IsString()
  @IsNotEmpty()
  make: string;

  @IsString()
  @IsNotEmpty()
  model: string;

  @IsInt()
  @Min(1980)
  @Max(new Date().getFullYear() + 1)
  year: number;

  @IsNumber()
  @IsPositive()
  price: number;

  @IsInt()
  @Min(0)
  mileage: number;

  @IsEnum(FuelType)
  fuelType: FuelType;

  @IsEnum(TransmissionType)
  transmission: TransmissionType;

  @IsOptional()
  @IsString()
  description?: string;
}