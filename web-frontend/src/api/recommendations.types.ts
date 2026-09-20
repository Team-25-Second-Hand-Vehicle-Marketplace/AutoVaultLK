import type { VehicleCardResult } from '../components/search/VehicleCard'

/**
 * A similar vehicle from `GET /recommendations/vehicles/:id`.
 *
 * Shaped to what `VehicleCard` renders, so the strip on the detail page reuses
 * the same card as search results with no adapter. That is why the repository
 * selects `is_negotiable` and `specs` — without them the frontend would have to
 * invent defaults, showing a wrong negotiable badge and no spec chips.
 */
export type RecommendedVehicle = VehicleCardResult & {
  /**
   * How close this vehicle scored to the one being viewed. Not rendered: the
   * ordering already expresses it, and a number beside a car means nothing to a
   * buyer.
   */
  similarityScore: number
}

export interface RecommendationsResponse {
  vehicleId: string
  recommendations: RecommendedVehicle[]
}
