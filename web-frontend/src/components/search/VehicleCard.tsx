import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, Fuel, Gauge, MapPin, ShieldCheck, Cog } from 'lucide-react'
import type { VehicleSearchResult } from '../../api/search.types'
import { SaveButton } from './SaveButton'
import { YearDisplay } from './YearDisplay'
import { formatMileage, formatPrice, humanizeEnum } from './vehicle-format'

/**
 * What the card actually needs. Wider than `VehicleSearchResult` on purpose:
 * the favourites endpoint joins the raw `Vehicle` row, which carries no
 * computed `imageUrl`, `thumbnailUrl` or `dealerVerified`. Each is read as a
 * truthiness check below, so absent behaves exactly like false - the card shows
 * its "no photo" placeholder and the verification badge is simply omitted.
 */
type OptionalOnCard =
  | 'effectiveYear'
  | 'imageUrl'
  | 'thumbnailUrl'
  | 'dealerVerified'
  | 'createdAt'

export type VehicleCardResult = Omit<VehicleSearchResult, OptionalOnCard> &
  Partial<Pick<VehicleSearchResult, OptionalOnCard>>

export function VehicleCard({ result }: { result: VehicleCardResult }) {
  // Only ever the listing's own photo. No photo means the placeholder below,
  // never a stock picture of some other vehicle.
  const image = result.thumbnailUrl ?? result.imageUrl ?? null
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const title = `${result.make} ${result.model}`

  return (
    <article className="nx-card">
      <div className="nx-card__media">
        {/* The whole media area links to the detail page; the save button sits
            outside the link so it doesn't navigate when clicked. */}
        <Link to={`/vehicles/${result.id}`} className="nx-card__media-link" aria-label={`View ${title}`}>
          {image && !failed ? (
            <img
              src={image}
              alt={title}
              className={`nx-card__img ${loaded ? 'is-loaded' : 'nx-img-fade'}`}
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          ) : (
            <div className="nx-card__noimg" aria-hidden="true">
              <Camera size={30} strokeWidth={1.4} />
              <span>{humanizeEnum(result.vehicleType)}</span>
              <small>No photos yet</small>
            </div>
          )}
        </Link>

        <div className="nx-card__badges">
          {result.dealerVerified && (
            <span className="nx-tag nx-tag--gold" title="Listed by a verified dealer">
              <ShieldCheck size={12} /> Verified
            </span>
          )}
          {result.condition && <span className="nx-tag">{humanizeEnum(result.condition)}</span>}
        </div>

        <div className="nx-card__save">
          <SaveButton vehicleId={result.id} />
        </div>
      </div>

      <div className="nx-card__body">
        <h3 className="nx-card__title">
          <Link to={`/vehicles/${result.id}`}>{title}</Link>
        </h3>

        <div className="nx-card__price">
          <span>LKR {formatPrice(result.price)}</span>
          {result.isNegotiable && <em>Negotiable</em>}
        </div>

        <ul className="nx-card__specs">
          <li>
            <Gauge size={14} /> {formatMileage(result.mileage)}
          </li>
          {result.fuelType && (
            <li>
              <Fuel size={14} /> {humanizeEnum(result.fuelType)}
            </li>
          )}
          {result.transmissionType && (
            <li>
              <Cog size={14} /> {result.transmissionType}
            </li>
          )}
          <li className="nx-card__year">
            <YearDisplay result={result} />
          </li>
        </ul>

        <div className="nx-card__loc">
          <MapPin size={13} /> {result.locationCity ?? result.locationDistrict ?? '-'}
        </div>
      </div>
    </article>
  )
}
