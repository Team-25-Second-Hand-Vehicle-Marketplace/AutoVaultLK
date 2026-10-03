import type { VehicleCardResult } from '../components/search/VehicleCard'

export interface Favourite {
  id: string
  buyerId: string
  vehicleId: string
  createdAt: string
  vehicle: FavouriteVehicle
}

/**
 * What the join actually returns. Identical to what `VehicleCard` accepts,
 * which is why the page can render a favourite without an adapter.
 */
export type FavouriteVehicle = VehicleCardResult

/** Confirmation body from `DELETE /favourites/:vehicleId`. */
export interface RemoveFavouriteResponse {
  message: string
}
