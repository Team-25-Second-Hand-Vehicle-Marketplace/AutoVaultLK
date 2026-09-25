export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'LIVE' | 'SOLD' | 'ARCHIVED' | 'REJECTED'

/**
 * FR-42.1. Where one field's value on a bulk-uploaded listing came from, and
 * Groq's stated reason when it repaired the value. Mirrors marketplace-
 * service's FieldNormalization (Vehicle entity) and, ultimately, ingestion-
 * service's FieldProvenance — the pipeline's own type.
 */
export type FieldNormalizationSource = 'rule' | 'dictionary' | 'raw' | 'groq'

export interface FieldNormalization {
  source: FieldNormalizationSource
  confidence: number
  reasoning?: string
}

/**
 * FR-42.1. Absent on a manually-created listing and on any row uploaded
 * before migration 29000 — there is no fallback value to show for those, and
 * the UI must treat "no normalization" as "nothing to review" rather than as
 * missing data.
 */
export interface VehicleNormalization {
  fields: Partial<Record<string, FieldNormalization>>
  rowConfidence: number
}

/**
 * An image row on a dealer's own listing, with `url`/`thumbnailUrl` already
 * resolved server-side (NFR-19 — the raw stored key is never itself
 * fetchable). Distinct from UploadedVehicleImage, which is the shape POST
 * /listings/:id/images returns right after an upload and carries no resolved
 * URL yet.
 */
export interface DealerListingImage {
  id: string
  isPrimary: boolean
  displayOrder: number
  url: string | null
  thumbnailUrl: string | null
}

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

  /** FR-42.1: null for a manually-created listing or one predating the column. */
  normalization: VehicleNormalization | null

  /** Type-specific attributes the enrich stage captured — body_type, seats, sunroof, etc. */
  specs: Record<string, unknown> | null

  /**
   * FR-35.2: set when this listing's registration_number was blank at
   * upload, so no automated image match could run — the dealer still needs
   * to attach a photo (or clear the flag by editing it) before it should go
   * LIVE. Absent/false on a manually-created listing, which always has a
   * registration number or none required at all.
   */
  needsManualReview: boolean
  reviewReason: string | null

  images: DealerListingImage[]
}

/** GET /marketplace/listings/mine?sort=... — FR-42.1's confidence-ascending sort. */
export const LISTING_SORT_OPTIONS = ['createdAt', 'confidence_asc'] as const
export type ListingSortOption = (typeof LISTING_SORT_OPTIONS)[number]

export interface ListingsEnvelope {
  message: string
  data: DealerListing[]
}

/**
 * A row from POST /marketplace/listings/:id/images — mirrors marketplace-
 * service's VehicleImage entity. `s3Path` is the raw storage key, not a
 * URL; the form has no use for it beyond confirming the upload landed; the
 * search/detail pages are what turn a vehicle's images back into fetchable
 * URLs via ImageUrlResolverService, not this response.
 */
export interface UploadedVehicleImage {
  id: string
  vehicleId: string
  s3Path: string
  isPrimary: boolean
  displayOrder: number
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
