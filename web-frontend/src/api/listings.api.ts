import { apiClient } from './client'
import type {
  CreateListingInput,
  DealerListing,
  ListingSortOption,
  ListingsEnvelope,
  UpdateListingInput,
} from './listings.types'

/** Every listing route answers `{ message, data }`. */
interface ListingEnvelope {
  message: string
  data: DealerListing
}

/**
 * GET /marketplace/listings/mine — every status, scoped to the JWT dealer.
 *
 * `sort: 'confidence_asc'` (FR-42.1) puts the PENDING_REVIEW rows most likely
 * to need a correction first, ahead of the ones the pipeline resolved
 * confidently.
 */
export async function getMyListings(
  sort?: ListingSortOption,
  signal?: AbortSignal,
): Promise<DealerListing[]> {
  const { data } = await apiClient.get<ListingsEnvelope>('/marketplace/listings/mine', {
    params: sort ? { sort } : undefined,
    signal,
  })
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

/**
 * PATCH /marketplace/listings/:id/approve — FR-42: moves a PENDING_REVIEW
 * listing to LIVE. The backend 409s if the listing is not PENDING_REVIEW,
 * distinct from the 404 an unknown/foreign id gets — see the api-error
 * detail surfaced by toErrorMessage.
 */
export async function approveListing(
  id: string,
  signal?: AbortSignal,
): Promise<DealerListing> {
  const { data } = await apiClient.patch<ListingEnvelope>(
    `/marketplace/listings/${id}/approve`,
    undefined,
    { signal },
  )
  return data.data
}
