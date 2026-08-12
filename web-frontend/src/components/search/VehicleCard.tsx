import { useState } from 'react'
import type { VehicleSearchResult } from '../../api/search.types'

function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 }).format(price)
}

function formatMileage(km: number): string {
  return `${new Intl.NumberFormat('en-LK').format(km)} km`
}

// The whole point of Decision 3: registrationYear is nullable because
// dealers omit it, and the backend already falls back to manufactureYear
// via COALESCE so the listing is never hidden. This is where that fallback
// becomes visible and honest to the buyer, instead of silently presenting
// a manufacture year as if it were the registration year.
function YearDisplay({ result }: { result: VehicleSearchResult }) {
  if (result.registrationYear === null) {
    return (
      <span title="Registration year not provided by dealer">
        {result.manufactureYear} <span className="year-note">(Mfg.)</span>
      </span>
    )
  }
  if (result.registrationYear !== result.manufactureYear) {
    return (
      <span>
        {result.registrationYear}{' '}
        <span className="year-note">(Mfg. {result.manufactureYear})</span>
      </span>
    )
  }
  return <span>{result.registrationYear}</span>
}

/**
 * Placeholder for a listing photo. Vehicle has no image storage wired up
 * yet (that's the ingestion/image-upload module, a separate PR), so this
 * renders a generic silhouette rather than a broken <img> or an empty box.
 * Swap for a real <img src={result.images[0]?.url}> once that exists.
 */
function ImagePlaceholder({ vehicleType }: { vehicleType: string }) {
  return (
    <div className="vehicle-card__image-placeholder" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13" />
        <path d="M3 13v4a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h12v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-4" />
        <circle cx="7" cy="16" r="1.5" />
        <circle cx="17" cy="16" r="1.5" />
      </svg>
      <span className="vehicle-card__image-placeholder-label">{vehicleType}</span>
    </div>
  )
}

export function VehicleCard({ result }: { result: VehicleSearchResult }) {
  // Local, unpersisted UI state only — no favourites API call yet, even
  // though marketplace-service already has a favourites module. Wiring
  // this to the real endpoint (and to auth, since only logged-in buyers
  // can save) is separate, later work.
  const [saved, setSaved] = useState(false)

  // No `featured` concept exists on Vehicle yet (no column, no backend
  // logic) — this is a purely cosmetic placeholder so the card's layout
  // matches the design now, ready to bind to a real field later.
  const isFeaturedPlaceholder = false

  return (
    <article className="vehicle-card">
      <div className="vehicle-card__media">
        <ImagePlaceholder vehicleType={result.vehicleType} />

        {isFeaturedPlaceholder && (
          <span className="badge badge--featured vehicle-card__featured-tag">Featured</span>
        )}

        <button
          type="button"
          className={saved ? 'vehicle-card__save vehicle-card__save--active' : 'vehicle-card__save'}
          aria-pressed={saved}
          aria-label={saved ? 'Remove from saved' : 'Save this listing'}
          title="Saving isn't wired up yet — coming soon"
          onClick={() => setSaved((v) => !v)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M12 21s-6.7-4.35-9.3-8.1C.8 10.1 1.4 6.6 4.3 5.1c2.2-1.1 4.6-.4 6 1.4l1.7 2.1 1.7-2.1c1.4-1.8 3.8-2.5 6-1.4 2.9 1.5 3.5 5 1.6 7.8C18.7 16.65 12 21 12 21z" />
          </svg>
        </button>
      </div>

      <div className="vehicle-card__body">
        <div className="vehicle-card__header">
          <h3>
            {result.make} {result.model}
          </h3>
          {result.dealerVerified && (
            <span className="badge badge--verified" title="Listed by a verified dealer">
              Verified Dealer
            </span>
          )}
        </div>

        <div className="vehicle-card__price">
          LKR {formatPrice(result.price)}
          {result.isNegotiable && <span className="badge badge--negotiable">Negotiable</span>}
        </div>

        <dl className="vehicle-card__specs">
          <div>
            <dt>Year</dt>
            <dd>
              <YearDisplay result={result} />
            </dd>
          </div>
          <div>
            <dt>Mileage</dt>
            <dd>{formatMileage(result.mileage)}</dd>
          </div>
          {result.fuelType && (
            <div>
              <dt>Fuel</dt>
              <dd>{result.fuelType}</dd>
            </div>
          )}
          {result.transmissionType && (
            <div>
              <dt>Transmission</dt>
              <dd>{result.transmissionType}</dd>
            </div>
          )}
        </dl>

        <div className="vehicle-card__location">
          {result.locationCity ?? result.locationDistrict ?? '—'}
        </div>
      </div>
    </article>
  )
}
