import type { Relaxation } from '../../api/search.types'

export function EmptyState({ relaxation }: { relaxation?: Relaxation }) {
  if (relaxation) {
    // The service already relaxed filters and found something — this
    // component only renders when total is still 0 even after relaxation,
    // so seeing a relaxation object here means every fallback in §8's
    // ladder was exhausted.
    return (
      <div className="empty-state">
        <p>No matches, even after widening your filters.</p>
        <p className="empty-state__detail">
          We tried relaxing: {relaxation.droppedFilters.join(', ')}.
        </p>
      </div>
    )
  }
  return (
    <div className="empty-state">
      <p>No vehicles match your filters.</p>
      <p className="empty-state__detail">Try widening your price range or removing a filter.</p>
    </div>
  )
}
