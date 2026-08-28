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
  // Scoped to vehicleType when provided — the payoff of the vehicle_types
  // column added in Phase 0.3b: a BIKE-scoped request excludes Toyota.
  makes: MakeOptionDto[];

  districts: string[];
}

export interface MarketplaceStatsDto {
  /** LIVE listings — the number a buyer can actually browse. */
  vehicleCount: number;
  /** Dealers with at least one LIVE listing. */
  dealerCount: number;
  /** Of those, how many are verified. */
  verifiedDealerCount: number;
  /** Distinct makes currently on sale. */
  makeCount: number;
  /** LIVE count per vehicle type, for the category tiles. */
  categories: { vehicleType: string; count: number }[];
  /** Makes with the most live inventory, for the brand grid. */
  topMakes: { make: string; count: number }[];
}
