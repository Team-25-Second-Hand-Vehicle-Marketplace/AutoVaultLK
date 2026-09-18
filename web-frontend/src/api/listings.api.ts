import { apiClient } from './client'
import type { DealerListing, ListingsEnvelope } from './listings.types'

/** GET /marketplace/listings/mine — every status, scoped to the JWT dealer. */
export async function getMyListings(signal?: AbortSignal): Promise<DealerListing[]> {
  const { data } = await apiClient.get<ListingsEnvelope>('/marketplace/listings/mine', { signal })
  return data.data
}
