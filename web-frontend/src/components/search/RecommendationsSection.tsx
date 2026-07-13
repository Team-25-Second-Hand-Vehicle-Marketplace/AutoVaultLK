import { useCallback } from 'react'
import { getRecommendations } from '../../api/recommendations.api'
import type { RecommendationsResponse } from '../../api/recommendations.types'
import { useAsyncData } from '../../hooks/useAsyncData'
import { VehicleCard } from './VehicleCard'
import { VehicleCardSkeleton } from './VehicleCardSkeleton'


/** Never surfaced - the section hides itself instead. */
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
