
export function VehicleCardSkeleton() {
  return (
    <article className="nx-card nx-card--skeleton" aria-hidden="true">
      <div className="nx-skel nx-skel--media" />
      <div className="nx-card__body">
        <div className="nx-skel nx-skel--line" style={{ width: '70%' }} />
        <div className="nx-skel nx-skel--line" style={{ width: '45%', height: 22 }} />
        <div className="nx-skel nx-skel--line" style={{ width: '90%' }} />
      </div>
    </article>
  )
}
