import { useId, useState } from 'react'
import type { DealerListing } from '../../api/listings.types'

/**
 * The stored detail behind a bulk-uploaded (or manual) listing that the
 * summary table row has no room for: the type-specific specs the enrich
 * stage captured, the manual-review flag for a row that arrived with no
 * registration number (FR-35.2), and the photos matched against it. Follows
 * the same collapsible-panel pattern as NormalizationDetails, and renders
 * nothing when a listing has none of the three to show — a manually-created
 * listing with a normal photo set should not grow an empty panel.
 */

function humanizeSpecKey(key: string): string {
  const words = key.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function formatSpecValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

const REVIEW_REASON_COPY: Record<string, string> = {
  NO_REGISTRATION_NUMBER:
    'No registration number was given, so photos could not be matched automatically.',
}

export function ListingDetails({ listing }: { listing: DealerListing }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  const specEntries = Object.entries(listing.specs ?? {})
  const images = listing.images ?? []
  const hasAnything = specEntries.length > 0 || listing.needsManualReview || images.length > 0

  if (!hasAnything) return null

  return (
    <div className="listing-details">
      <button
        type="button"
        className="listing-details__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide' : 'Show'} specs & photos
        {listing.needsManualReview && (
          <span className="listing-details__flag">Needs a photo</span>
        )}
      </button>

      {open && (
        <div id={panelId} className="listing-details__panel">
          {listing.needsManualReview && (
            <p className="listing-details__review-note" role="status">
              {REVIEW_REASON_COPY[listing.reviewReason ?? ''] ??
                'This listing is flagged for manual review.'}
            </p>
          )}

          {specEntries.length > 0 && (
            <dl className="listing-details__specs">
              {specEntries.map(([key, value]) => (
                <div key={key} className="listing-details__spec">
                  <dt>{humanizeSpecKey(key)}</dt>
                  <dd>{formatSpecValue(value)}</dd>
                </div>
              ))}
            </dl>
          )}

          {images.length > 0 ? (
            <div className="listing-details__images">
              {images.map((image) => (
                <figure key={image.id} className="listing-details__image">
                  {image.thumbnailUrl ? (
                    <img src={image.thumbnailUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="listing-details__image-placeholder" aria-hidden="true" />
                  )}
                  {image.isPrimary && (
                    <figcaption className="listing-details__image-badge">Primary</figcaption>
                  )}
                </figure>
              ))}
            </div>
          ) : (
            <p className="listing-details__no-images">No photos matched yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
