import type { VehicleTypeValue } from '../../api/search.types'

/**
 * Line icons for the vehicle-type tiles.
 *
 * Drawn as inline SVG rather than the emoji the design mock uses: emoji
 * render as full-colour vendor art that ignores the page's palette and
 * differs between Windows, macOS, and Android, which is exactly the
 * inconsistency the rest of this UI avoids. These inherit currentColor.
 */
export function CategoryIcon({ type }: { type: VehicleTypeValue }) {
  const common = {
    width: 26,
    height: 26,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (type) {
    case 'BIKE':
      return (
        <svg {...common}>
          <circle cx="5.5" cy="17" r="3.5" />
          <circle cx="18.5" cy="17" r="3.5" />
          <path d="M5.5 17 9 8h4l3 9M9 8 8 5H6M13 8h4" />
        </svg>
      )
    case 'THREE_WHEELER':
      return (
        <svg {...common}>
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="17" cy="18" r="2.5" />
          <path d="M6 18h11M8 18V9a3 3 0 0 1 3-3h1l4 6v6" />
        </svg>
      )
    case 'VAN':
    case 'BUS':
      return (
        <svg {...common}>
          <rect x="2.5" y="6" width="19" height="10" rx="2" />
          <path d="M2.5 11h19M9 6v5" />
          <circle cx="7" cy="18.5" r="1.8" />
          <circle cx="17" cy="18.5" r="1.8" />
        </svg>
      )
    case 'TRUCK':
    case 'LORRY':
      return (
        <svg {...common}>
          <path d="M2.5 15V7a1 1 0 0 1 1-1h9v9M13 10h4l3.5 3.5V15" />
          <circle cx="7" cy="17.5" r="2" />
          <circle cx="17" cy="17.5" r="2" />
        </svg>
      )
    case 'PICKUP':
      return (
        <svg {...common}>
          <path d="M2.5 15v-3l3-4h5v7M10.5 12h11v3" />
          <circle cx="7" cy="17.5" r="2" />
          <circle cx="17.5" cy="17.5" r="2" />
        </svg>
      )
    case 'TRACTOR':
      return (
        <svg {...common}>
          <circle cx="7" cy="16.5" r="4" />
          <circle cx="18" cy="17.5" r="2.5" />
          <path d="M7 12.5V8h4l2 4.5M13 8h4v5" />
        </svg>
      )
    case 'HEAVY_MACHINERY':
      return (
        <svg {...common}>
          <path d="M3 17v-4h7V9h4l3 4M10 13l7-6" />
          <circle cx="6" cy="18" r="2.2" />
          <circle cx="16" cy="18" r="2.2" />
        </svg>
      )
    case 'SUV':
      return (
        <svg {...common}>
          <path d="M3 15v-3l2.5-4h10l3.5 4H21v3" />
          <path d="M3 15h18M9 8v4" />
          <circle cx="7.5" cy="17.5" r="2" />
          <circle cx="16.5" cy="17.5" r="2" />
        </svg>
      )
    default:
      // CAR and anything new: a generic saloon silhouette rather than a
      // broken/empty tile.
      return (
        <svg {...common}>
          <path d="M3 15v-2.5l2-4.5h12l2 4.5V15" />
          <path d="M3 15h18M6 12.5h12" />
          <circle cx="7.5" cy="17.5" r="1.9" />
          <circle cx="16.5" cy="17.5" r="1.9" />
        </svg>
      )
  }
}
