import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getMyFavourites } from '../api/favourites.api'
import type { Favourite } from '../api/favourites.types'
import { toErrorMessage } from '../api/client'
import { useAsyncData } from '../hooks/useAsyncData'
import { useSavedVehicles } from '../hooks/useSavedVehicles'
import { VehicleCard } from '../components/search/VehicleCard'
import { VehicleCardSkeleton } from '../components/search/VehicleCardSkeleton'

const favouritesError = (err: unknown) =>
  toErrorMessage(err, 'Could not load your saved listings.')

export function SavedPage() {
  // `savedIds` is not rendered — it is the refetch key. Un-hearting a card from
  // this page changes it, which re-runs the fetch below so the row disappears
  // without a manual reload.
  const { savedIds } = useSavedVehicles()
  const key = savedIds.join(',')

  const fetchFavourites = useCallback(
    (signal: AbortSignal) => {
      void key
      return getMyFavourites(signal)
    },
    [key],
  )

  const { data, loading, error } = useAsyncData<Favourite[]>(
    fetchFavourites,
    favouritesError,
  )

  const favourites = data ?? []

  return (
    <div className="saved-page">
      <h1>Saved vehicles</h1>

      {loading && (
        <div className="vehicle-grid" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <VehicleCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="search-error" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && favourites.length === 0 && (
        <div className="empty-state">
          <p>You haven't saved any vehicles yet.</p>
          <p className="empty-state__detail">
            Tap the heart on any listing to keep it here.
          </p>
          <Link className="button button--primary" to="/search">
            Browse vehicles
          </Link>
        </div>
      )}

      {!loading && !error && favourites.length > 0 && (
        <div className="vehicle-grid">
          {favourites.map((favourite) => (
            // The vehicle arrives joined on the favourite row, so this is one
            // request rather than one per saved id as it used to be.
            <VehicleCard key={favourite.id} result={favourite.vehicle} />
          ))}
        </div>
      )}
    </div>
  )
}
