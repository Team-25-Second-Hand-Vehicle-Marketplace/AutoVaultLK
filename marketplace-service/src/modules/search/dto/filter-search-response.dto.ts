import { VehicleTypeValue } from '../constants/vehicle-attributes.constants';

/**
 * One row in the result grid. A deliberately thin projection of Vehicle —
 * embedding and search_vector are select:false at the entity level and
 * never belong in a buyer-facing payload anyway.
 */
export interface VehicleSearchResultDto {
  id: string;
  vehicleType: VehicleTypeValue;
  make: string;
  model: string;
  manufactureYear: number;
  registrationYear: number | null;
  // The year actually used by filtering/display — COALESCE(registration,
  // manufacture). Decision 3: the frontend renders this as the headline
  // year and shows manufactureYear as a parenthetical when they differ.
  effectiveYear: number;
  price: number;
  isNegotiable: boolean;
  mileage: number;
  fuelType: string | null;
  transmissionType: string | null;
  locationCity: string | null;
  locationDistrict: string | null;
  specs: Record<string, unknown>;
  dealerVerified: boolean;
  createdAt: Date;
}

// One dimension's facet counts, e.g. { value: 'PETROL', count: 34 } for fuelType.
export interface FacetBucketDto {
  value: string;
  count: number;
}

export interface FacetsDto {
  vehicleType?: FacetBucketDto[];
  make?: FacetBucketDto[];
  fuelType?: FacetBucketDto[];
  transmissionType?: FacetBucketDto[];
  condition?: FacetBucketDto[];
}

/**
 * Populated only when the initial filter set returned zero rows and the
 * service applied §8's relaxation ladder. `droppedFilters` lists what was
 * removed to produce a non-empty result; `priceCeilingExceeded` is set
 * separately because price is never silently dropped — design doc §8:
 * "Never silently drop an explicit price ceiling; surface it in the UI
 * instead."
 */
export interface RelaxationDto {
  droppedFilters: string[];
  priceCeilingExceeded?: boolean;
  message: string;
}

export interface FilterSearchResponseDto {
  items: VehicleSearchResultDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  appliedFilters: Record<string, unknown>;
  facets?: FacetsDto;
  relaxation?: RelaxationDto;
}
