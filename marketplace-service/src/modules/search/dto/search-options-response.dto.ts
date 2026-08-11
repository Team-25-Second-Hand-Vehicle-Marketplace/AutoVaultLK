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
}
