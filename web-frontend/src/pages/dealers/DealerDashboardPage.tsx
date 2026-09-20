import { useCallback } from 'react'
import { getMyDealerProfile } from '../../api/dealer.api'
import type { DealerProfile } from '../../api/dealer.types'
import { getMyListings } from '../../api/listings.api'
import type { DealerListing, ListingStatus } from '../../api/listings.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { ErrorBanner } from '../../components/ui/ErrorBanner'

const STATUS_TILES: { label: string; statuses: ListingStatus[] }[] = [
  { label: 'Live', statuses: ['LIVE'] },
  { label: 'Pending review', statuses: ['PENDING_REVIEW'] },
  { label: 'Draft', statuses: ['DRAFT'] },
  { label: 'Sold', statuses: ['SOLD'] },
  { label: 'Rejected', statuses: ['REJECTED'] },
  { label: 'Archived', statuses: ['ARCHIVED'] },
]

function countByStatus(listings: DealerListing[], statuses: ListingStatus[]): number {
  return listings.filter((l) => statuses.includes(l.status)).length
}

const profileError = (err: unknown) => toErrorMessage(err, 'Could not load your dealer profile.')
const listingsError = (err: unknown) => toErrorMessage(err, 'Could not load your listings.')

export function DealerDashboardPage() {
  const fetchProfile = useCallback((signal: AbortSignal) => getMyDealerProfile(signal), [])
  const fetchListings = useCallback((signal: AbortSignal) => getMyListings(signal), [])

  const profile = useAsyncData<DealerProfile>(fetchProfile, profileError)
  const listings = useAsyncData<DealerListing[]>(fetchListings, listingsError)

  if (profile.loading) {
    return (
      <div className="dealer-page">
        <p className="dealer-muted" role="status">
          Loading dashboard…
        </p>
      </div>
    )
  }

  if (profile.error || !profile.data) {
    return (
      <div className="dealer-page">
        <ErrorBanner message={profile.error ?? 'No data'} />
      </div>
    )
  }

  const dealer = profile.data

  return (
    <div className="dealer-page">
      <header className="dealer-page__header">
        <h1>{dealer.companyName}</h1>
        <p>Your dealership at a glance.</p>
      </header>

      <VerificationBanner dealer={dealer} />

      {listings.loading ? (
        <p className="dealer-muted" role="status">
          Loading your listings…
        </p>
      ) : listings.error || !listings.data ? (
        <ErrorBanner message={listings.error ?? 'No data'} />
      ) : (
        <div className="dealer-tiles">
          {STATUS_TILES.map((tile) => (
            <div key={tile.label} className="dealer-tiles__item">
              <span className="dealer-tiles__label">{tile.label}</span>
              <strong className="dealer-tiles__value">
                {countByStatus(listings.data!, tile.statuses)}
              </strong>
            </div>
          ))}
        </div>
      )}

      <p className="dealer-note">
        {dealer.dealerType === 'individual'
          ? 'As an individual dealer, add vehicles one at a time from My listings.'
          : 'As a business dealer, upload your whole inventory at once from Bulk upload, or add vehicles individually from My listings.'}
      </p>
    </div>
  )
}

function VerificationBanner({ dealer }: { dealer: DealerProfile }) {
  if (dealer.verificationStatus === 'VERIFIED') {
    return (
      <div className="dealer-banner dealer-banner--verified">
        <strong>Verified dealer</strong>
        <span>Your account has been verified by an administrator.</span>
      </div>
    )
  }

  if (dealer.verificationStatus === 'REJECTED') {
    return (
      <div className="dealer-banner dealer-banner--rejected">
        <strong>Verification rejected</strong>
        <span>{dealer.rejectionReason ?? 'Contact support for details.'}</span>
      </div>
    )
  }

  return (
    <div className="dealer-banner dealer-banner--pending">
      <strong>Verification pending</strong>
      <span>An administrator is reviewing your account. Some actions are unavailable until you&apos;re verified.</span>
    </div>
  )
}
