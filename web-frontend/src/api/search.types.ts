export type VehicleTypeValue =
  | 'CAR' | 'BIKE' | 'VAN' | 'TRUCK' | 'SUV' | 'BUS'
  | 'THREE_WHEELER' | 'LORRY' | 'PICKUP' | 'TRACTOR' | 'HEAVY_MACHINERY'

export type SortOption =
  | 'relevance' | 'price_asc' | 'price_desc' | 'year_desc' | 'mileage_asc' | 'newest'

export interface SpecFilter {
  key: string
  value: string
}

// Mirrors marketplace-service FilterSearchDto. All values are what get
// serialized into the query string — arrays become comma-joined.
export interface FilterSearchParams {
  vehicleType?: VehicleTypeValue[]
  make?: string[]
  model?: string[]
  condition?: string[]
  fuelType?: string[]
  transmissionType?: string[]
  color?: string[]
  locationCity?: string[]
  locationDistrict?: string[]
  minPrice?: number
  maxPrice?: number
  minYear?: number
  maxYear?: number
  minMileage?: number
  maxMileage?: number
  maxOwners?: number
  isNegotiable?: boolean
  hasRegistrationYear?: boolean
  verifiedDealersOnly?: boolean
  specs?: SpecFilter[]
  q?: string
  sort?: SortOption
  page?: number
  limit?: number
  facets?: boolean
}

export interface VehicleSearchResult {
  id: string
  vehicleType: VehicleTypeValue
  make: string
  model: string
  condition: string | null
  manufactureYear: number
  registrationYear: number | null
  effectiveYear: number
  price: number
  isNegotiable: boolean
  mileage: number
  fuelType: string | null
  transmissionType: string | null
  locationCity: string | null
  locationDistrict: string | null
  specs: Record<string, unknown>
  dealerVerified: boolean
  // Null until image upload is wired up — every environment currently has
  // zero rows in vehicle_images, so the card renders a placeholder.
  imageUrl: string | null
  thumbnailUrl: string | null
  createdAt: string
}

export interface VehicleDealer {
  id: string
  companyName: string | null
  city: string | null
  contactNumber: string | null
  verified: boolean
}

export interface VehicleDetail extends VehicleSearchResult {
  description: string | null
  color: string | null
  ownersCount: number | null
  engineCapacityCc: number | null
  images: string[]
  dealer: VehicleDealer
}

export interface FacetBucket {
  value: string
  count: number
}

export interface Facets {
  vehicleType?: FacetBucket[]
  make?: FacetBucket[]
  fuelType?: FacetBucket[]
  transmissionType?: FacetBucket[]
  condition?: FacetBucket[]
}

export interface Relaxation {
  droppedFilters: string[]
  priceCeilingExceeded?: boolean
  message: string
}

export interface FilterSearchResponse {
  items: VehicleSearchResult[]
  total: number
  page: number
  limit: number
  totalPages: number
  appliedFilters: Record<string, unknown>
  facets?: Facets
  relaxation?: Relaxation
}

export interface MakeOption {
  id: string
  name: string
  models: { id: string; name: string }[]
}

/**
 * Landing-page headline figures, all computed from live inventory.
 *
 * The design reference also shows "Happy Buyers" and a "Satisfaction Rate";
 * neither has any source in this system (no orders, no reviews), so they are
 * absent rather than invented.
 */
export interface MarketplaceStats {
  vehicleCount: number
  dealerCount: number
  verifiedDealerCount: number
  makeCount: number
  categories: { vehicleType: VehicleTypeValue; count: number }[]
  topMakes: { make: string; count: number }[]
}

export interface SearchOptionsResponse {
  vehicleTypes: readonly VehicleTypeValue[]
  conditions: readonly string[]
  fuelTypes: readonly string[]
  transmissionTypes: readonly string[]
  bodyTypes: string[]
  makes: MakeOption[]
  // Districts that actually have live inventory — derived from vehicles, so
  // the filter can never offer a district with nothing in it.
  districts: string[]
}
