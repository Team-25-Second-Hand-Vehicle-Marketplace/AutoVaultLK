export type VehicleTypeValue =
  | 'CAR' | 'BIKE' | 'VAN' | 'TRUCK' | 'SUV' | 'BUS'
  | 'THREE_WHEELER' | 'LORRY' | 'PICKUP' | 'TRACTOR' | 'HEAVY_MACHINERY'

export type SortOption =
  | 'relevance' | 'price_asc' | 'price_desc' | 'year_desc' | 'mileage_asc' | 'newest'

export interface SpecFilter {
  key: string
  value: string
}

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

/** Control params for GET /marketplace/search/nl — not sidebar filters. */
export interface NlSearchParams {
  q: string
  sort?: SortOption
  page?: number
  limit?: number
  facets?: boolean
}

export interface NlParse {
  confidence: number
  needsGroqFallback: boolean
  usedGroqFallback: boolean
  usedSemanticRanking: boolean
  usedTrigramFallback: boolean
  unresolvedTokens: string[]
  semanticText: string
}

export interface NlSearchResponse extends FilterSearchResponse {
  parse: NlParse
}

export interface MakeOption {
  id: string
  name: string
  models: { id: string; name: string }[]
}

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
  districts: string[]
}
