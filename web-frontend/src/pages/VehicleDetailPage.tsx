import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import axios from 'axios'
import { getVehicleById } from '../api/search.api'
import { toErrorMessage } from '../api/client'
import type { VehicleDetail } from '../api/search.types'
import { SaveButton } from '../components/search/SaveButton'
import { YearDisplay } from '../components/search/YearDisplay'
import { formatMileage, formatPrice, humanizeEnum } from '../components/search/vehicle-format'
import { demoImageFor, isContainImage } from '../assets/demo-images'

/** specs is untyped JSONB; render whatever is there rather than a fixed list. */
function formatSpecKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatSpecValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

export function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [state, setState] = useState<{
    vehicle: VehicleDetail | null
    loading: boolean
    error: string | null
    notFound: boolean
  }>({ vehicle: null, loading: true, error: null, notFound: false })
  const { vehicle, loading, error, notFound } = state

  const [galleryFailed, setGalleryFailed] = useState(false)

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()

    getVehicleById(id, controller.signal)
      .then((v) => {
        if (!controller.signal.aborted) {
          setState({ vehicle: v, loading: false, error: null, notFound: false })
        }
      })
      .catch((err) => {
        if (axios.isCancel(err) || controller.signal.aborted) return

        if (axios.isAxiosError(err) && err.response?.status === 404) {
          setState({ vehicle: null, loading: false, error: null, notFound: true })
          return
        }
        setState({
          vehicle: null,
          loading: false,
          error: toErrorMessage(err, 'Could not load this listing.'),
          notFound: false,
        })
      })

    return () => controller.abort()
  }, [id])

  if (loading) {
    return (
      <div className="detail-page" role="status" aria-live="polite">
        <div className="skeleton skeleton--media detail-page__gallery-skeleton" />
        <div className="skeleton skeleton--line skeleton--title" />
        <div className="skeleton skeleton--line skeleton--price" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="error-page">
        <h1>Listing not available</h1>
        <p>This vehicle may have been sold or removed.</p>
        <Link className="button button--primary" to="/search">
          Browse other vehicles
        </Link>
      </div>
    )
  }

  if (error || !vehicle) {
    return (
      <div className="error-page" role="alert">
        <h1>Something went wrong</h1>
        <p>{error ?? 'Could not load this listing.'}</p>
        <Link className="button button--primary" to="/search">
          Back to search
        </Link>
      </div>
    )
  }

  const specEntries = Object.entries(vehicle.specs ?? {}).filter(
    ([, value]) => value !== null && value !== '',
  )


  const primaryImage =
    vehicle.images[0] ??
    demoImageFor(vehicle.id, {
      vehicleType: vehicle.vehicleType,
      make: vehicle.make,
      model: vehicle.model,
      bodyType: typeof vehicle.specs.body_type === 'string' ? vehicle.specs.body_type : undefined,
      fuelType: vehicle.fuelType,
      price: vehicle.price,
    })

  return (
    <div className="detail-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/search">Search</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">
          {vehicle.make} {vehicle.model}
        </span>
      </nav>

      <div className="detail-page__grid">
        <div className="detail-page__main">
          <div className="detail-gallery">
            {vehicle.images.length > 0 || !galleryFailed ? (
              <img
                src={primaryImage}
                alt={`${vehicle.make} ${vehicle.model}`}
                className={
                  isContainImage(primaryImage)
                    ? 'detail-gallery__primary detail-gallery__primary--contain'
                    : 'detail-gallery__primary'
                }
                onError={() => setGalleryFailed(true)}
              />
            ) : (
              // No environment has image rows yet; say so plainly rather
              // than showing a broken image icon.
              <div className="detail-gallery__placeholder">
                <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13" />
                  <path d="M3 13v4a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h12v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-4" />
                  <circle cx="7" cy="16" r="1.5" />
                  <circle cx="17" cy="16" r="1.5" />
                </svg>
                <p>No photos provided for this listing</p>
              </div>
            )}

            {vehicle.images.length > 1 && (
              <div className="detail-gallery__thumbs">
                {vehicle.images.slice(1).map((src) => (
                  <img key={src} src={src} alt="" className="detail-gallery__thumb" />
                ))}
              </div>
            )}
          </div>

          {vehicle.description && (
            <section className="detail-section">
              <h2>Description</h2>
              <p className="detail-description">{vehicle.description}</p>
            </section>
          )}

          <section className="detail-section">
            <h2>Specifications</h2>
            <dl className="detail-specs">
              <div>
                <dt>Vehicle type</dt>
                <dd>{humanizeEnum(vehicle.vehicleType)}</dd>
              </div>
              <div>
                <dt>Year</dt>
                <dd>
                  <YearDisplay result={vehicle} />
                </dd>
              </div>
              <div>
                <dt>Mileage</dt>
                <dd>{formatMileage(vehicle.mileage)}</dd>
              </div>
              {vehicle.condition && (
                <div>
                  <dt>Condition</dt>
                  <dd>{vehicle.condition}</dd>
                </div>
              )}
              {vehicle.fuelType && (
                <div>
                  <dt>Fuel</dt>
                  <dd>{vehicle.fuelType}</dd>
                </div>
              )}
              {vehicle.transmissionType && (
                <div>
                  <dt>Transmission</dt>
                  <dd>{vehicle.transmissionType}</dd>
                </div>
              )}
              {vehicle.color && (
                <div>
                  <dt>Colour</dt>
                  <dd>{vehicle.color}</dd>
                </div>
              )}
              {vehicle.engineCapacityCc !== null && (
                <div>
                  <dt>Engine</dt>
                  <dd>{vehicle.engineCapacityCc} cc</dd>
                </div>
              )}
              {vehicle.ownersCount !== null && (
                <div>
                  <dt>Previous owners</dt>
                  <dd>{vehicle.ownersCount}</dd>
                </div>
              )}
              {specEntries.map(([key, value]) => (
                <div key={key}>
                  <dt>{formatSpecKey(key)}</dt>
                  <dd>{formatSpecValue(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <aside className="detail-page__aside">
          <div className="detail-summary">
            <div className="detail-summary__header">
              <h1>
                {vehicle.make} {vehicle.model}
              </h1>
              <SaveButton vehicleId={vehicle.id} />
            </div>

            <div className="detail-summary__price">
              LKR {formatPrice(vehicle.price)}
              {vehicle.isNegotiable && (
                <span className="badge badge--negotiable">Negotiable</span>
              )}
            </div>

            <div className="detail-summary__location">
              {[vehicle.locationCity, vehicle.locationDistrict].filter(Boolean).join(', ') || '—'}
            </div>

            <div className="detail-dealer">
              <h2>Dealer</h2>
              <p className="detail-dealer__name">
                {vehicle.dealer.companyName ?? 'Private seller'}
                {vehicle.dealer.verified && (
                  <span className="badge badge--verified" title="Verified dealer">
                    Verified
                  </span>
                )}
              </p>
              {vehicle.dealer.city && <p>{vehicle.dealer.city}</p>}
              {vehicle.dealer.contactNumber && (
                <a className="button button--primary" href={`tel:${vehicle.dealer.contactNumber}`}>
                  Call {vehicle.dealer.contactNumber}
                </a>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
