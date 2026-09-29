import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getMyListings } from '../../api/listings.api'
import type { DealerListing, ListingStatus } from '../../api/listings.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { StatusBadge } from '../../components/dealers/StatusBadge'
import { PieChart } from '../../components/admin/PieChart'
import { formatPrice } from '../../components/search/vehicle-format'
import { DealerVerificationGate } from './DealerVerificationGate'
import { useDealerProfile } from './useDealerProfile'

const RECENT_LISTINGS_COUNT = 5

// No SOLD tile: nothing in marketplace-service ever sets a listing to SOLD —
// it's a valid status in the schema with no code path that reaches it. A
// dealer marks a vehicle unavailable by archiving it instead, so Archived is
// the tile that actually means "no longer for sale" here.
const STATUS_TILES: { label: string; statuses: ListingStatus[] }[] = [
  { label: 'Live', statuses: ['LIVE'] },
  { label: 'Pending review', statuses: ['PENDING_REVIEW'] },
  { label: 'Draft', statuses: ['DRAFT'] },
  { label: 'Rejected', statuses: ['REJECTED'] },
  { label: 'Archived', statuses: ['ARCHIVED'] },
]

function countByStatus(listings: DealerListing[], statuses: ListingStatus[]): number {
  return listings.filter((l) => statuses.includes(l.status)).length
}

function primaryThumbnail(listing: DealerListing): string | null {
  const primary = listing.images.find((img) => img.isPrimary) ?? listing.images[0]
  return primary?.thumbnailUrl ?? primary?.url ?? null
}

const listingsError = (err: unknown) => toErrorMessage(err, 'Could not load your listings.')

export function DealerDashboardPage() {
  const fetchListings = useCallback((signal: AbortSignal) => getMyListings(undefined, signal), [])

  const profile = useDealerProfile()
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

  // A dealer can now log in while PENDING or REJECTED (approval no longer
  // gates login — see auth-user-service's DealerProfilesService). Until
  // they're VERIFIED, this is the only thing they get; see
  // RequireVerifiedDealer and DealerLayout's empty nav for the rest.
  if (dealer.verificationStatus !== 'VERIFIED') {
    return <DealerVerificationGate profile={profile} />
  }

  return (
    <div className="dealer-page">
      <header className="dealer-page__header">
        <h1>{dealer.companyName}</h1>
        <p>Your dealership at a glance.</p>
      </header>

      <div className="dealer-banner dealer-banner--verified">
        <strong>Verified dealer</strong>
        <span>Your account has been verified by an administrator.</span>
      </div>

      {listings.loading ? (
        <p className="dealer-muted" role="status">
          Loading your listings…
        </p>
      ) : listings.error || !listings.data ? (
        <ErrorBanner message={listings.error ?? 'No data'} />
      ) : (
        <>
          <div className="dealer-tiles">
            {STATUS_TILES.map((tile) => (
              <div key={tile.label} className="dealer-tiles__item">
                <span className="dealer-tiles__label">{tile.label}</span>
                <strong className="dealer-tiles__value">
                  {countByStatus(listings.data!, tile.statuses)}
                </strong>
              </div>
            ))}
            <div className="dealer-tiles__item">
              <span className="dealer-tiles__label">Live inventory value</span>
              <strong className="dealer-tiles__value">
                LKR{' '}
                {formatPrice(
                  listings.data!
                    .filter((l) => l.status === 'LIVE')
                    .reduce((sum, l) => sum + l.price, 0),
                )}
              </strong>
            </div>
          </div>

          <div className="dealer-grid">
            <section className="upload-card">
              <div className="upload-card__head">
                <h2>Recent listings</h2>
                <Link to="/dealer/listings">My listings</Link>
              </div>
              {listings.data!.length === 0 ? (
                <p className="dealer-muted">No listings yet.</p>
              ) : (
                <ul className="recent-listings">
                  {[...listings.data!]
                    .sort(
                      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                    )
                    .slice(0, RECENT_LISTINGS_COUNT)
                    .map((listing) => {
                      const thumbnail = primaryThumbnail(listing)
                      return (
                        <li key={listing.id} className="recent-listings__item">
                          {thumbnail ? (
                            <img src={thumbnail} alt="" loading="lazy" />
                          ) : (
                            <span className="recent-listings__no-image" aria-hidden="true" />
                          )}
                          <span className="recent-listings__title">
                            {listing.make} {listing.model}
                          </span>
                          <span className="recent-listings__price">
                            LKR {formatPrice(listing.price)}
                          </span>
                          <StatusBadge status={listing.status} />
                        </li>
                      )
                    })}
                </ul>
              )}
            </section>

            <section className="upload-card">
              <div className="upload-card__head">
                <h2>Inventory by make</h2>
              </div>
              <PieChart
                data={Object.entries(
                  listings.data!.reduce<Record<string, number>>((acc, l) => {
                    acc[l.make] = (acc[l.make] ?? 0) + 1
                    return acc
                  }, {}),
                ).map(([label, value]) => ({ label, value }))}
                emptyMessage="No inventory to chart yet."
              />
            </section>
          </div>
        </>
      )}

      <p className="dealer-note">
        {dealer.dealerType === 'individual' ? (
          <>
            As an individual dealer, add your vehicles one at a time from{' '}
            <Link to="/dealer/listings">My listings</Link>.
          </>
        ) : (
          'As a business dealer, upload your whole inventory at once from Bulk upload.'
        )}
      </p>
    </div>
  )
}
