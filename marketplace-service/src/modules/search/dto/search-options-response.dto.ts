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
  // Districts with live inventory, for the location filter. Derived from
  // vehicles, not a static list of all 25 districts — a district with
  // nothing in it can only produce an empty result set.
  districts: string[];
}

/**
 * Headline figures for the landing page.
 *
 * Every value is computed from live data. The design reference also shows
 * "Happy Buyers" and a "Satisfaction Rate", which have no source in this
 * system — there is no order, review, or rating table — so they are not
 * modelled here rather than being invented.
 */
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
