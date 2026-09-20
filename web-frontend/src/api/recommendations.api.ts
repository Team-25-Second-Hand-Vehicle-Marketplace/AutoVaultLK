import { apiClient } from './client'
import type { RecommendationsResponse } from './recommendations.types'

/**
 * Vehicles similar to the one being viewed (FR-25).
 *
 * `limit` is clamped server-side to [1, 20] with a default of 6, so nothing is
 * re-clamped here — one authority for the bound is enough, and a second would
 * only drift from it.
 */
export async function getRecommendations(
  vehicleId: string,
  limit?: number,
  signal?: AbortSignal,
): Promise<RecommendationsResponse> {
  const { data } = await apiClient.get<RecommendationsResponse>(
    `/marketplace/recommendations/vehicles/${vehicleId}`,
    { params: limit ? { limit } : undefined, signal },
  )
  return data
}
