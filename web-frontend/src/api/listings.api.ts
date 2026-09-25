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

/**
 * DELETE /marketplace/listings/:id — permanently removes the listing.
 * Distinct from `deactivateListing`, which only hides it: the backend 409s
 * unless the listing is DRAFT, PENDING_REVIEW or REJECTED — a LIVE, SOLD or
 * ARCHIVED listing can only be archived, never deleted.
 */
export async function deleteListing(id: string, signal?: AbortSignal): Promise<void> {
  await apiClient.delete(`/marketplace/listings/${id}`, { signal })
}

/** Every images route answers `{ message, data }` with an array of rows. */
interface ImagesEnvelope {
  message: string
  data: UploadedVehicleImage[]
}

/**
 * POST /marketplace/listings/:id/images — FR-58. Replaces the listing's
 * whole image set; a re-upload means "this is the current set of photos",
 * not "add more to what's there". The first file in `files` becomes the
 * primary photo.
 *
 * The backend 400s in demo mode (IMAGE_SERVE_MODE=demo, the local dev
 * default) — an upload it can never serve back is a worse failure than
 * refusing it outright. toErrorMessage surfaces that message directly.
 */
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
      // Content-Type deliberately unset: the browser must add the
      // multipart boundary itself (see uploadInventory in ingestion.api.ts
      // for the same reasoning) — naming the header here would overwrite it
      // with one that has no boundary.
    },
  )
  return data.data
}
