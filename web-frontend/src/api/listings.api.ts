import { apiClient } from './client'
import type {
  CreateListingInput,
  DealerListing,
  ListingsEnvelope,
  UpdateListingInput,
} from './listings.types'

/** Every listing route answers `{ message, data }`. */
interface ListingEnvelope {
  message: string
  data: DealerListing
}

/** GET /marketplace/listings/mine — every status, scoped to the JWT dealer. */
export async function getMyListings(signal?: AbortSignal): Promise<DealerListing[]> {
  const { data } = await apiClient.get<ListingsEnvelope>('/marketplace/listings/mine', { signal })
  return data.data
}

/**
 * POST /marketplace/listings — DEALER or ADMIN only.
 *
 * The owner comes from the JWT, never the body, so there is no dealer id to
 * pass. A manual listing lands PENDING_REVIEW unless `status: 'DRAFT'` is sent.
 */
export async function createListing(
  input: CreateListingInput,
  signal?: AbortSignal,
): Promise<DealerListing> {
  const { data } = await apiClient.post<ListingEnvelope>(
    '/marketplace/listings',
    input,
    { signal },
  )
  return data.data
}

/** PATCH /marketplace/listings/:id — cannot change status; see deactivateListing. */
export async function updateListing(
  id: string,
  input: UpdateListingInput,
  signal?: AbortSignal,
): Promise<DealerListing> {
  const { data } = await apiClient.patch<ListingEnvelope>(
    `/marketplace/listings/${id}`,
    input,
    { signal },
  )
  return data.data
}

/**
 * PATCH /marketplace/listings/:id/deactivate — sets status to ARCHIVED.
 *
 * Its own route rather than a status field on update, so archiving is always a
 * deliberate act rather than something a stray field could do.
 */
export async function deactivateListing(
  id: string,
  signal?: AbortSignal,
): Promise<DealerListing> {
  const { data } = await apiClient.patch<ListingEnvelope>(
    `/marketplace/listings/${id}/deactivate`,
    undefined,
    { signal },
  )
  return data.data
}
