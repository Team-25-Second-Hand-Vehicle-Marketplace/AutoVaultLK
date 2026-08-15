
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
