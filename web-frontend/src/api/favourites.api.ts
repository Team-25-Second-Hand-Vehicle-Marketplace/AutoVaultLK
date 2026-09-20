import axios from 'axios'
import { apiClient } from './client'
import type { Favourite, RemoveFavouriteResponse } from './favourites.types'

/**
 * Favourites live server-side so a buyer's saved list survives a device change.
 *
 * The path is `/favourites`, not `/marketplace/favourites` — nginx proxies
 * `location /marketplace/` to `http://marketplace_service/` and the trailing
 * slash strips the prefix, so the service sees the bare path.
 */

export async function getMyFavourites(signal?: AbortSignal): Promise<Favourite[]> {
  const { data } = await apiClient.get<Favourite[]>('/marketplace/favourites', { signal })
  return data
}

export async function addFavourite(
  vehicleId: string,
  signal?: AbortSignal,
): Promise<Favourite> {
  const { data } = await apiClient.post<Favourite>(
    `/marketplace/favourites/${vehicleId}`,
    undefined,
    { signal },
  )
  return data
}

export async function removeFavourite(
  vehicleId: string,
  signal?: AbortSignal,
): Promise<RemoveFavouriteResponse> {
  const { data } = await apiClient.delete<RemoveFavouriteResponse>(
    `/marketplace/favourites/${vehicleId}`,
    { signal },
  )
  return data
}

/**
 * A 409 from add, or a 404 from remove, means the server already holds the
 * state the caller was asking for — the vehicle is saved, or it is not. Neither
 * is a failure worth showing or rolling back for; both mean client and server
 * agree, which is the point of the request.
 */
export function isAlreadyInDesiredState(error: unknown, operation: 'add' | 'remove'): boolean {
  if (!axios.isAxiosError(error)) return false

  const status = error.response?.status
  return operation === 'add' ? status === 409 : status === 404
}
