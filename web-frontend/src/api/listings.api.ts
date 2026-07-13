import { apiClient } from './client'
import type {
  CreateListingInput,
  DealerListing,
  ListingSortOption,
  ListingsEnvelope,
  UpdateListingInput,
  UploadedVehicleImage,
} from './listings.types'

/** Every listing route answers `{ message, data }`. */
interface ListingEnvelope {
  message: string
  data: DealerListing
}

/**
 * GET /marketplace/listings/mine - every status, scoped to the JWT dealer.
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
 * POST /marketplace/listings - DEALER or ADMIN only.
 *
 * The owner comes from the JWT, never the body, so there is no dealer id to
 * pass. A manual listing lands PENDING_REVIEW unless `status: 'DRAFT'` is sent.
 */
/**
 * Creating or editing a listing (re-embedding it for search) and uploading photos
 * are slower than a normal call, especially on a cold backend, so they get more
 * than the client's 10s default. Cutting them off early does not stop the server:
 * the listing still gets created, the client just never hears about it.
 */
const SLOW_WRITE_TIMEOUT_MS = 60_000

export async function createListing(
  input: CreateListingInput,
  signal?: AbortSignal,
): Promise<DealerListing> {
  const { data } = await apiClient.post<ListingEnvelope>(
    '/marketplace/listings',
    input,
    { signal, timeout: SLOW_WRITE_TIMEOUT_MS },
  )
  return data.data
}

/** PATCH /marketplace/listings/:id - cannot change status; see deactivateListing. */
export async function updateListing(
  id: string,
  input: UpdateListingInput,
  signal?: AbortSignal,
): Promise<DealerListing> {
  const { data } = await apiClient.patch<ListingEnvelope>(
    `/marketplace/listings/${id}`,
    input,
    { signal, timeout: SLOW_WRITE_TIMEOUT_MS },
  )
  return data.data
}

/**
 * PATCH /marketplace/listings/:id/deactivate - sets status to ARCHIVED.
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
 * PATCH /marketplace/listings/:id/unarchive - reverses deactivateListing,
 * bringing an ARCHIVED listing back to LIVE. The backend 409s if the listing
 * is not ARCHIVED.
 */
export async function unarchiveListing(
  id: string,
  signal?: AbortSignal,
): Promise<DealerListing> {
  const { data } = await apiClient.patch<ListingEnvelope>(
    `/marketplace/listings/${id}/unarchive`,
    undefined,
    { signal },
  )
  return data.data
}

/**
 * PATCH /marketplace/listings/:id/approve - FR-42: moves a PENDING_REVIEW
 * listing to LIVE. The backend 409s if the listing is not PENDING_REVIEW,
 * distinct from the 404 an unknown/foreign id gets - see the api-error
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

/** The server accepts at most this many ids per approve-selected request. */
const APPROVE_SELECTED_BATCH = 1000

/**
 * PATCH /marketplace/listings/approve-selected - approves the given listings
 * that are the dealer's own and still PENDING_REVIEW. Anything else in the list
 * is skipped, not an error, so `skipped` can be non-zero. A selection larger
 * than the server's limit goes in several requests and the counts are summed.
 */
export async function approveSelectedListings(
  ids: string[],
  signal?: AbortSignal,
): Promise<{ approved: number; skipped: number }> {
  let approved = 0
  let skipped = 0

  for (let i = 0; i < ids.length; i += APPROVE_SELECTED_BATCH) {
    const { data } = await apiClient.patch<{
      message: string
      data: { approved: number; skipped: number }
    }>(
      '/marketplace/listings/approve-selected',
      { ids: ids.slice(i, i + APPROVE_SELECTED_BATCH) },
      { signal },
    )
    approved += data.data.approved
    skipped += data.data.skipped
  }

  return { approved, skipped }
}

/**
 * DELETE /marketplace/listings/:id - permanently removes the listing.
 * Distinct from `deactivateListing`, which only hides it: the backend 409s
 * unless the listing is DRAFT, PENDING_REVIEW or REJECTED - a LIVE, SOLD or
 * ARCHIVED listing can only be archived, never deleted.
 */
export async function deleteListing(id: string, signal?: AbortSignal): Promise<void> {
  await apiClient.delete(`/marketplace/listings/${id}`, { signal })
}

/**
 * DELETE /marketplace/listings/:id/images/:imageId - FR-58. Removes one
 * photo, leaving the rest in place. Distinct from `uploadListingImages`,
 * which replaces the whole set: the edit form has no File object for a photo
 * it only knows as a stored URL, so removing one without resending every
 * other photo needs its own route.
 */
export async function deleteListingImage(
  id: string,
  imageId: string,
  signal?: AbortSignal,
): Promise<void> {
  await apiClient.delete(`/marketplace/listings/${id}/images/${imageId}`, { signal })
}

/** Every images route answers `{ message, data }` with an array of rows. */
interface ImagesEnvelope {
  message: string
  data: UploadedVehicleImage[]
}

export async function uploadListingImages(
  id: string,
  files: File[],
  signal?: AbortSignal,
): Promise<UploadedVehicleImage[]> {
  const form = new FormData()
  for (const file of files) form.append('images', file)

  const { data } = await apiClient.post<ImagesEnvelope>(
    `/marketplace/listings/${id}/images`,
    form,
    {
      signal,
      timeout: SLOW_WRITE_TIMEOUT_MS,
      // Content-Type deliberately unset: the browser must add the
      // multipart boundary itself (see uploadInventory in ingestion.api.ts
      // for the same reasoning) - naming the header here would overwrite it
      // with one that has no boundary.
    },
  )
  return data.data
}
