import type { VehicleCardResult } from '../components/search/VehicleCard'

/**
 * A row from `GET /favourites`, with its vehicle joined.
 *
 * The backend requests `relations: { vehicle: true }` and orders
 * `createdAt DESC`, so the list arrives newest-first with the vehicle attached
 * — one request rather than one per saved id.
 *
 * `vehicle` is the raw `Vehicle` entity rather than the search-result shape, so
 * it carries no `imageUrl`, `thumbnailUrl` or `dealerVerified`. `VehicleCard`
 * tolerates all three being absent: it falls back to `demoImageFor` for the
 * image and renders no verification badge.
 */
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
