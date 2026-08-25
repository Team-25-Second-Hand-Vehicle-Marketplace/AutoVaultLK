import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { getVehicleById } from '../api/search.api'
import { toErrorMessage } from '../api/client'
import type { VehicleDetail } from '../api/search.types'
import { useSavedVehicles } from '../hooks/useSavedVehicles'
import { VehicleCard } from '../components/search/VehicleCard'
import { VehicleCardSkeleton } from '../components/search/VehicleCardSkeleton'

/**
 * The buyer's saved listings.
 *
 * Saved ids live client-side (see useSavedVehicles — the favourites API
 * doesn't exist on this branch), so each one is fetched individually rather
 * than through a single /favourites call. That is fine at this scale and
 * collapses to one request when the server-side module lands.
 *
 * Ids that 404 are dropped silently: a saved listing that has since sold or
 * been withdrawn is expected, not an error worth showing.
 */
export function SavedPage() {
  const { savedIds } = useSavedVehicles()
  // Single state value: a load resolves to either a list or an error, and
  // the empty-ids case resolves synchronously to an empty list. Keeping them
  // together removes the setLoading/setError reset the effect used to do
  // synchronously before every fetch.
  const [state, setState] = useState<{
    vehicles: VehicleDetail[]
    loading: boolean
    error: string | null
  }>({ vehicles: [], loading: true, error: null })
  const { vehicles, loading, error } = state

  useEffect(() => {
    const controller = new AbortController()

    if (savedIds.length === 0) {
      // Deferred to a microtask so this is not a synchronous setState in the
      // effect body; there is nothing to fetch, so nothing to wait for.
      queueMicrotask(() => {
        if (!controller.signal.aborted) {
          setState({ vehicles: [], loading: false, error: null })
        }
      })
      return () => controller.abort()
    }

    Promise.all(
      savedIds.map((id) =>
        getVehicleById(id, controller.signal).catch((err) => {
          if (axios.isCancel(err)) throw err
          return null // sold, withdrawn, or otherwise gone
        }),
      ),
    )
      .then((results) => {
        if (!controller.signal.aborted) {
          setState({
            vehicles: results.filter((v): v is VehicleDetail => v !== null),
            loading: false,
            error: null,
          })
        }
      })
      .catch((err) => {
        if (axios.isCancel(err) || controller.signal.aborted) return
        setState({
          vehicles: [],
          loading: false,
          error: toErrorMessage(err, 'Could not load your saved listings.'),
        })
      })

    return () => controller.abort()
  }, [savedIds])

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

      {!loading && !error && vehicles.length === 0 && (
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

      {!loading && vehicles.length > 0 && (
        <div className="vehicle-grid">
          {vehicles.map((vehicle) => (
            <VehicleCard key={vehicle.id} result={vehicle} />
          ))}
        </div>
      )}
    </div>
  )
}
