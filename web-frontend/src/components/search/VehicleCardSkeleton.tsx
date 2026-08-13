/**
 * Shape-matched placeholder for VehicleCard.
 *
 * Mirrors the real card's media/title/price/spec-row layout so the grid
 * doesn't reflow when results arrive. Marked aria-hidden by the caller —
 * the loading state is announced once via the results count's live region
 * rather than repeated by every skeleton.
 */
export function VehicleCardSkeleton() {
  return (
    <article className="vehicle-card vehicle-card--skeleton">
      <div className="skeleton skeleton--media" />
      <div className="vehicle-card__body">
        <div className="skeleton skeleton--line skeleton--title" />
        <div className="skeleton skeleton--line skeleton--price" />
        <div className="skeleton-specs">
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line" />
        </div>
        <div className="skeleton skeleton--line skeleton--location" />
      </div>
    </article>
  )
}
