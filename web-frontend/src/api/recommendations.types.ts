import type { VehicleCardResult } from '../components/search/VehicleCard'

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
