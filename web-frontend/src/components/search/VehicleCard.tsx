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

export function VehicleCard({ result }: { result: VehicleSearchResult }) {
  return (
    <article className="vehicle-card">
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
    </article>
  )
}
