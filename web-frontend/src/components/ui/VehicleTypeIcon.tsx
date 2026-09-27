interface Props {
  /** A `VehicleTypeValue` such as CAR or THREE_WHEELER; unknown values get a car. */
  type: string
  size?: number
  className?: string
}

/**
 * Small line icons, one per vehicle type, in side profile. They draw in
 * `currentColor`, so they take the colour of whatever they sit in, and they are
 * decorative (the label next to them carries the meaning).
 */
export function VehicleTypeIcon({ type, size = 22, className }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  }

  switch (type) {
    case 'SUV':
      return (
        <svg {...common}>
          <path d="M3 16v-3.4c0-.5.2-1 .5-1.3L6 8.6a2 2 0 0 1 1.5-.7h8.2a2 2 0 0 1 1.6.8l2.4 3.2c.2.3.3.6.3 1V16" />
          <path d="M3 16h2M9.5 16h5M19 16h2M8 8v3.6h10.5" />
          <circle cx="7.2" cy="16.5" r="2" />
          <circle cx="16.8" cy="16.5" r="2" />
        </svg>
      )
    case 'BIKE':
      return (
        <svg {...common}>
          <circle cx="5.5" cy="16.5" r="3.2" />
          <circle cx="18.5" cy="16.5" r="3.2" />
          <path d="M5.5 16.5 9 10h5l3 3 1.5 3.5" />
          <path d="M9 10 8 7H6M14 10l1-3h2.5M10 13.5h4" />
        </svg>
      )
    case 'THREE_WHEELER':
      return (
        <svg {...common}>
          <path d="M11 17.5H6.5M11 17.5V9a2 2 0 0 1 2-2h5.5a1 1 0 0 1 1 1v9.5" />
          <path d="M3 17.5V11l4-3h4M15.5 11H11" />
          <circle cx="5.5" cy="17.8" r="1.9" />
          <circle cx="16" cy="17.8" r="1.9" />
        </svg>
      )
    case 'VAN':
      return (
        <svg {...common}>
          <path d="M2.5 16V8.5a1.5 1.5 0 0 1 1.5-1.5h9v9M13 9.5h4.2a1.5 1.5 0 0 1 1.2.6l2.4 3.1c.2.3.3.6.3.9V16" />
          <path d="M2.5 16h2M9.5 16h3.5M18.5 16h3" />
          <circle cx="7" cy="16.5" r="2" />
          <circle cx="16" cy="16.5" r="2" />
        </svg>
      )
    case 'BUS':
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="18" height="12.5" rx="2.2" />
          <path d="M3 11h18M12 4.5V11M7 4.5V11M17 4.5V11" />
          <circle cx="7.5" cy="18.4" r="1.6" />
          <circle cx="16.5" cy="18.4" r="1.6" />
        </svg>
      )
    case 'TRUCK':
    case 'LORRY':
      return (
        <svg {...common}>
          <path d="M2.5 16V6.5A1.5 1.5 0 0 1 4 5h9.5v11M13.5 9h3.7a1.5 1.5 0 0 1 1.2.6l2.4 3.2c.2.3.3.6.3.9V16" />
          <path d="M2.5 16h2M9.5 16h4M18.5 16h3" />
          <circle cx="7" cy="16.7" r="2" />
          <circle cx="16.5" cy="16.7" r="2" />
        </svg>
      )
    case 'PICKUP':
      return (
        <svg {...common}>
          <path d="M2.5 16v-3.4c0-.4.1-.8.4-1.1L5.6 8.8a2 2 0 0 1 1.5-.6h4.2l1.7 3.4H21.5V16" />
          <path d="M12.7 11.6V16M2.5 16h2M9.7 16h1.9M18.5 16h3" />
          <circle cx="7" cy="16.6" r="2" />
          <circle cx="16.5" cy="16.6" r="2" />
        </svg>
      )
    case 'TRACTOR':
      return (
        <svg {...common}>
          <circle cx="6.5" cy="16.5" r="3.6" />
          <circle cx="18" cy="17.5" r="2.4" />
          <path d="M9.4 14.4 12 6.5h4l1 5.5h3.5v1.5M12 6.5V4M14 11.5H9.5" />
        </svg>
      )
    case 'HEAVY_MACHINERY':
      return (
        <svg {...common}>
          <path d="M3 17.5h13M4.5 17.5v-3.2H12V9.8h3.6l1.8 4.5" />
          <path d="M13 11.5 18.5 5l2.5 3-3.8 6.3" />
          <circle cx="7" cy="19.3" r=".01" />
        </svg>
      )
    default:
      // CAR and anything new: a saloon silhouette rather than a blank tile.
      return (
        <svg {...common}>
          <path d="M3.5 16v-3c0-.5.2-1 .5-1.3l2.4-2.7A2 2 0 0 1 7.9 8.3h6.8a2 2 0 0 1 1.5.7l2.3 2.7c.3.3.5.8.5 1.3V16" />
          <path d="M3.5 16h2M9.5 16h5M18.5 16h2M9 8.3v3.4h8.5" />
          <circle cx="7.5" cy="16.5" r="2" />
          <circle cx="16.5" cy="16.5" r="2" />
        </svg>
      )
  }
}
