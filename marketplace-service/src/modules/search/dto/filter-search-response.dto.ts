import { VehicleTypeValue } from '../constants/vehicle-attributes.constants';


export interface VehicleSearchResultDto {
  id: string;
  vehicleType: VehicleTypeValue;
  make: string;
  model: string;
  condition: string | null;
  manufactureYear: number;
  registrationYear: number | null;

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

  imageUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: Date;
}


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
