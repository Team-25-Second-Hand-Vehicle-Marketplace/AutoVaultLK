import type { ListingStatus } from '../../api/listings.types'

export function StatusBadge({ status }: { status: ListingStatus }) {
  return (
    <span className={`listing-status listing-status--${status.toLowerCase()}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}
