import {
  ConditionValue,
  FuelTypeValue,
  TransmissionTypeValue,
  VehicleTypeValue,
} from '../constants/vehicle-attributes.constants';

export interface MakeOptionDto {
  id: string;
  name: string;
  models: { id: string; name: string }[];
}

export interface SearchOptionsResponseDto {
  vehicleTypes: readonly VehicleTypeValue[];
  conditions: readonly ConditionValue[];
  fuelTypes: readonly FuelTypeValue[];
  transmissionTypes: readonly TransmissionTypeValue[];
  bodyTypes: string[];
  makes: MakeOptionDto[];
  districts: string[];
}


export interface MarketplaceStatsDto {

  vehicleCount: number;

  dealerCount: number;

  verifiedDealerCount: number;

  makeCount: number;

  categories: { vehicleType: string; count: number }[];

  topMakes: { make: string; count: number }[];
}
