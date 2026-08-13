import type { Relaxation } from '../../api/search.types'

/** Human-readable names for the ladder's internal step identifiers. */
const DROPPED_FILTER_LABELS: Record<string, string> = {
  specs: 'vehicle specs',
  q: 'your keyword',
  hasRegistrationYear: 'the confirmed-registration-year requirement',
  mileageRange: 'the mileage range',
  yearRange: 'the year range',
}

function describeDropped(keys: string[]): string {
  return keys.map((key) => DROPPED_FILTER_LABELS[key] ?? key).join(', ')
}

export function EmptyState({
  relaxation,
  onClearFilters,
}: {
  relaxation?: Relaxation
  onClearFilters?: () => void
}) {
  return (
    <div className="empty-state">
      <svg
        className="empty-state__icon"
        viewBox="0 0 24 24"
        width="48"
        height="48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>

      {relaxation ? (
        <>
          {/* This component only renders when the result set is empty, so a
              relaxation object here means every step of the ladder ran and
              still found nothing. */}
          <p>No matches, even after widening your search.</p>
          <p className="empty-state__detail">
            We tried relaxing {describeDropped(relaxation.droppedFilters)}.
          </p>
        </>
      ) : (
        <>
          <p>No vehicles match your filters.</p>
          <p className="empty-state__detail">
            Try widening your price range, or removing a filter or two.
          </p>
        </>
      )}

      {onClearFilters && (
        <button type="button" className="button button--ghost" onClick={onClearFilters}>
          Clear all filters
        </button>
      )}
    </div>
  )
}
