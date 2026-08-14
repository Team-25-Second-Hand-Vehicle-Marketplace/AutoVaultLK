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
  condition: string | null;
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
  // Real per-row value from a LEFT JOIN on auth.dealer_profiles — not, as
  // before, an echo of the verifiedDealersOnly filter (which made the badge
  // appear only where it carried no information).
  dealerVerified: boolean;
  // Primary listing photo, null when the dealer hasn't uploaded one. Every
  // environment currently has zero rows in vehicle_images, so null is the
  // normal case and the frontend renders a silhouette placeholder.
  imageUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: Date;
}

/**
 * A single listing for the detail page: everything in the grid projection
 * plus the fields too heavy or too rarely used to send for all 20 cards.
 */
export interface VehicleDealerDto {
  id: string;
  companyName: string | null;
  city: string | null;
  contactNumber: string | null;
  verified: boolean;
}

export interface VehicleDetailDto extends VehicleSearchResultDto {
  description: string | null;
  color: string | null;
  ownersCount: number | null;
  engineCapacityCc: number | null;
  // All photos, primary first. Empty until image upload is wired up.
  images: string[];
  dealer: VehicleDealerDto;
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
