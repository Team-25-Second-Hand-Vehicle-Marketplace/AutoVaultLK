import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { VehicleSearchResult } from '../../api/search.types'
import { demoImageFor, isContainImage } from '../../assets/demo-images'
import { SaveButton } from './SaveButton'
import { YearDisplay } from './YearDisplay'
import { formatMileage, formatPrice, humanizeEnum } from './vehicle-format'

function ImagePlaceholder({ vehicleType }: { vehicleType: string }) {
  return (
    <div className="vehicle-card__image-placeholder" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13" />
        <path d="M3 13v4a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h12v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-4" />
        <circle cx="7" cy="16" r="1.5" />
        <circle cx="17" cy="16" r="1.5" />
      </svg>
      <span className="vehicle-card__image-placeholder-label">{humanizeEnum(vehicleType)}</span>
    </div>
  )
}

export function VehicleCard({ result }: { result: VehicleSearchResult }) {

  const image =
    result.thumbnailUrl ??
    result.imageUrl ??
    demoImageFor(result.id, {
      vehicleType: result.vehicleType,
      make: result.make,
      model: result.model,
      bodyType: typeof result.specs.body_type === 'string' ? result.specs.body_type : undefined,
      fuelType: result.fuelType,
      price: result.price,
    })

  const [failed, setFailed] = useState(false)

  return (
    <article className="vehicle-card">
      <div className="vehicle-card__media">
        {/* The whole card is a link to the detail page; the save button sits
            outside it so it doesn't navigate when clicked. */}
        <Link
          to={`/vehicles/${result.id}`}
          className="vehicle-card__media-link"
          aria-label={`View ${result.make} ${result.model}`}
        >
          {image && !failed ? (
            <img
              src={image}
              alt={`${result.make} ${result.model}`}
              className={
                isContainImage(image)
                  ? 'vehicle-card__image vehicle-card__image--contain'
                  : 'vehicle-card__image'
              }
              loading="lazy"
              onError={() => setFailed(true)}
            />
          ) : (
            <ImagePlaceholder vehicleType={result.vehicleType} />
          )}
        </Link>

        <SaveButton vehicleId={result.id} />
      </div>

      <div className="vehicle-card__body">
        <div className="vehicle-card__header">
          <h3>
            <Link to={`/vehicles/${result.id}`} className="vehicle-card__title-link">
              {result.make} {result.model}
            </Link>
          </h3>
          {result.dealerVerified && (
            <span className="badge badge--verified" title="Listed by a verified dealer">
              Verified
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

        <div className="vehicle-card__footer">
          <span className="vehicle-card__location">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
            {result.locationCity ?? result.locationDistrict ?? '—'}
          </span>
          {result.condition && <span className="badge badge--condition">{result.condition}</span>}
        </div>
      </div>
    </article>
  )
}
