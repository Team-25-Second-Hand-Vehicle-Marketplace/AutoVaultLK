export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'LIVE' | 'SOLD' | 'ARCHIVED' | 'REJECTED'

/**
 * A row from GET /marketplace/listings/mine — the dealer's own inventory across
 * every status, not the public search-result shape.
 *
 * The repository returns the whole `Vehicle` entity with no `select`, so the
 * editable fields below arrive with the list. That is what lets the edit form
 * pre-fill without a second request per listing.
 */
export interface DealerListing {
  id: string
  status: ListingStatus
  make: string
  model: string
  manufactureYear: number
  price: number
  mileage: number
  createdAt: string

  // Present on the row, and needed to pre-fill an edit.
  registrationYear: number | null
  fuelType: string | null
  transmissionType: string | null
  vehicleType: string | null
  condition: string | null
  description: string | null
}

export interface ListingsEnvelope {
  message: string
  data: DealerListing[]
}

/**
 * The vehicle types the manual listing form offers — all eleven the database
 * accepts, matching `VehicleTypeValue`.
 *
 * This was six until `CreateListingDto` was fixed. Migration 20000 extended
 * vehicle_type to eleven values and updated the entity, the ingestion
 * write-entity and the search constants, but not that DTO — so a dealer could
 * bulk-upload a lorry and not create one by hand. The DTO now derives its
 * vocabulary from the same canonical list, and `listings-contract.test.ts`
 * fails the build if the two ever diverge again.
 */
export const LISTABLE_VEHICLE_TYPES = [
  'CAR',
  'BIKE',
  'VAN',
  'TRUCK',
  'SUV',
  'BUS',
  'THREE_WHEELER',
  'LORRY',
  'PICKUP',
  'TRACTOR',
  'HEAVY_MACHINERY',
] as const

export type ListableVehicleType = (typeof LISTABLE_VEHICLE_TYPES)[number]

export const FUEL_TYPES = ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'CNG'] as const
export type FuelType = (typeof FUEL_TYPES)[number]

export const TRANSMISSION_TYPES = [
  'MANUAL',
  'AUTOMATIC',
  'CVT',
  'SEMI_AUTOMATIC',
] as const
export type TransmissionType = (typeof TRANSMISSION_TYPES)[number]

export const CONDITIONS = ['NEW', 'USED', 'RECONDITIONED'] as const
export type Condition = (typeof CONDITIONS)[number]

/** A dealer may only create a DRAFT or publish LIVE; review states are the platform's. */
export const MANUAL_STATUSES = ['DRAFT', 'LIVE'] as const
export type ManualStatus = (typeof MANUAL_STATUSES)[number]

/**
 * Body for POST /listings, mirroring CreateListingDto.
 *
 * `dealerId` is omitted on purpose: the DTO declares it but the service ignores
 * it and takes the owner from the verified JWT (FR-13/FR-58). Sending it would
 * imply it does something.
 */
export interface CreateListingInput {
  make: string
  model: string
  manufactureYear: number
  price: number
  mileage: number
  fuelType: FuelType
  transmissionType: TransmissionType
  vehicleType?: ListableVehicleType
  condition?: Condition
  registrationYear?: number
  description?: string
  status?: ManualStatus
  specs?: Record<string, unknown>
}

/**
 * Body for PATCH /listings/:id.
 *
 * `UpdateListingDto` is `PartialType(OmitType(CreateListingDto, ['status']))`,
 * so an edit cannot change status — that is what the deactivate route is for.
 */
export type UpdateListingInput = Partial<Omit<CreateListingInput, 'status'>>
