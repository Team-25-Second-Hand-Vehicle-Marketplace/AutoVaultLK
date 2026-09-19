export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'LIVE' | 'SOLD' | 'ARCHIVED' | 'REJECTED'

/** Shape of a raw row from GET /marketplace/listings/mine — the dealer's own
 * inventory across every status, not the public search-result shape. */
export interface DealerListing {
  id: string
  status: ListingStatus
  make: string
  model: string
  manufactureYear: number
  price: number
  mileage: number
  createdAt: string
}

export interface ListingsEnvelope {
  message: string
  data: DealerListing[]
}
