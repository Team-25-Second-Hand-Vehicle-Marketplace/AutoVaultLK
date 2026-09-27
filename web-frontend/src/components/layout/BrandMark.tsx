import { useId } from 'react'
import { Link } from 'react-router-dom'

/**
 * A car inside a shield, sitting on a road: trust (shield) applied to a
 * vehicle marketplace (car, road). Matches the concept the team picked from
 * generated references — see the design chat for the source image.
 *
 * `clipId` is per-render (useId) because BrandMark appears more than once on
 * the same page (header + footer), and two elements sharing one `id` would
 * make the second instance's `clipPath` reference ambiguous.
 */
export function BrandMark({ to = '/' }: { to?: string | null }) {
  const clipId = useId()

  const content = (
    <>
      <span className="brand__tile" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <defs>
            <clipPath id={clipId}>
              <path d="M7 3h10a3 3 0 0 1 3 3v6c0 6-3.8 8.8-8 9.5-4.2-.7-8-3.5-8-9.5V6a3 3 0 0 1 3-3z" />
            </clipPath>
          </defs>

          {/* The shield's lower third, solid — the "vault" half of the mark. */}
          <g clipPath={`url(#${clipId})`}>
            <rect x="2" y="16" width="20" height="8" fill="currentColor" />
          </g>

          {/* The shield's outline, stroked over the fill so the two halves
              read as one continuous shape rather than a filled shape with a
              gap on top. */}
          <path
            d="M7 3h10a3 3 0 0 1 3 3v6c0 6-3.8 8.8-8 9.5-4.2-.7-8-3.5-8-9.5V6a3 3 0 0 1 3-3z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />

          {/* A car, sitting on the road line — the "marketplace" half. Same
              silhouette as VehicleTypeIcon's CAR mark, scaled to fit. */}
          <g
            transform="translate(4.5 3.4) scale(0.68)"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 16v-3c0-.5.2-1 .5-1.3l2.4-2.7A2 2 0 0 1 7.9 8.3h6.8a2 2 0 0 1 1.5.7l2.3 2.7c.3.3.5.8.5 1.3V16" />
            <circle cx="7.5" cy="16.5" r="2" />
            <circle cx="16.5" cy="16.5" r="2" />
          </g>

          {/* The road the car sits on, level with its wheels. */}
          <path
            d="M5.4 16h13.2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeDasharray="1.8 1.4"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="brand__name">
        AutoVault<span>LK</span>
      </span>
    </>
  )

  if (to === null) {
    return <span className="brand">{content}</span>
  }

  return (
    <Link to={to} className="brand">
      {content}
    </Link>
  )
}
