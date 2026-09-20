import { useCallback } from 'react'
import { getRecommendations } from '../../api/recommendations.api'
import type { RecommendationsResponse } from '../../api/recommendations.types'
import { useAsyncData } from '../../hooks/useAsyncData'
import { VehicleCard } from './VehicleCard'
import { VehicleCardSkeleton } from './VehicleCardSkeleton'

/**
 * Similar vehicles, shown under the detail page (FR-25).
 *
 * Both the empty and the error case render **nothing at all**. A rare vehicle
 * having no near neighbours is not something a buyer needs told, and a
 * recommendations outage must not put an error box on the page they actually
 * asked for. The listing itself is the content; this is an addition to it.
 */

/** Never surfaced — the section hides itself instead. */
const swallow = () => ''

export function RecommendationsSection({ vehicleId }: { vehicleId: string }) {
  const fetchRecommendations = useCallback(
    (signal: AbortSignal) => getRecommendations(vehicleId, undefined, signal),
    [vehicleId],
  )

  const { data, loading, error } = useAsyncData<RecommendationsResponse>(
    fetchRecommendations,
    swallow,
  )

  if (loading) {
    return (
      <section className="detail-section recommendations" aria-busy="true">
        <h2>Similar vehicles</h2>
        <div className="recommendations__strip" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <VehicleCardSkeleton key={i} />
          ))}
        </div>
      </section>
    )
  }

  const recommendations = data?.recommendations ?? []
  if (error || recommendations.length === 0) return null

  return (
    <section className="detail-section recommendations">
      <h2>Similar vehicles</h2>
      <div className="recommendations__strip">
        {recommendations.map((vehicle) => (
          <VehicleCard key={vehicle.id} result={vehicle} />
        ))}
      </div>
    </section>
  )
}
