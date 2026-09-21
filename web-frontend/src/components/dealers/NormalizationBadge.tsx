import { useId, useState } from 'react'
import type { VehicleNormalization } from '../../api/listings.types'

/**
 * FR-42.1: which fields on a PENDING_REVIEW listing the pipeline inferred,
 * and why, so the dealer can spot-check the ones most likely to be wrong
 * before approving. Renders nothing for a manually-created listing or one
 * that predates migration 29000 — both arrive as `normalization: null`, and
 * there is nothing to review either way.
 */

const FIELD_LABELS: Record<string, string> = {
  make: 'Make',
  model: 'Model',
  vehicleType: 'Vehicle type',
  condition: 'Condition',
  manufactureYear: 'Year',
  registrationYear: 'Registration year',
  price: 'Price',
  mileage: 'Mileage',
  fuelType: 'Fuel type',
  transmissionType: 'Transmission',
  engineCapacityCc: 'Engine capacity',
  color: 'Color',
  ownersCount: 'Owners',
  locationCity: 'City',
  locationDistrict: 'District',
  registrationNumber: 'Registration number',
  chassisNumber: 'Chassis number',
  description: 'Description',
  specs: 'Specifications',
}

const SOURCE_LABELS: Record<string, string> = {
  rule: 'Parsed',
  dictionary: 'Matched',
  raw: 'As entered',
  groq: 'AI-corrected',
}

/**
 * Below this, a field is flagged for attention even without an AI correction
 * — a dictionary/rule match this weak is one the dealer should double-check
 * regardless of source. Matches the pipeline's fuzzy-match floor
 * (CONFIDENCE_FUZZY in dictionary-snapshot.ts) so "low confidence" means the
 * same thing here that it means in the pipeline that produced it.
 */
const LOW_CONFIDENCE_THRESHOLD = 0.6

export function NormalizationSummary({
  normalization,
}: {
  normalization: VehicleNormalization | null
}) {
  if (!normalization) return null

  const entries = Object.entries(normalization.fields).filter(
    (entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] !== undefined,
  )
  if (entries.length === 0) return null

  const aiCorrected = entries.filter(([, field]) => field.source === 'groq').length
  const lowConfidence = entries.filter(([, field]) => field.confidence < LOW_CONFIDENCE_THRESHOLD)

  return (
    <div className="normalization-summary">
      {aiCorrected > 0 && (
        <span className="normalization-pill normalization-pill--ai">
          {aiCorrected} AI-corrected
        </span>
      )}
      {lowConfidence.length > 0 && (
        <span className="normalization-pill normalization-pill--low">
          {lowConfidence.length} low confidence
        </span>
      )}
    </div>
  )
}

export function NormalizationDetails({
  normalization,
}: {
  normalization: VehicleNormalization | null
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  if (!normalization) return null

  const entries = Object.entries(normalization.fields)
    .filter(
      (entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] !== undefined,
    )
    // Weakest first — the ones worth checking first belong at the top of an
    // already-open panel, not buried under a screenful of confident ones.
    .sort((a, b) => a[1].confidence - b[1].confidence)

  if (entries.length === 0) return null

  return (
    <div className="normalization-details">
      <button
        type="button"
        className="normalization-details__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide' : 'Show'} field details ({entries.length})
      </button>

      {open && (
        <dl id={panelId} className="normalization-details__list">
          {entries.map(([field, info]) => (
            <div key={field} className="normalization-field">
              <dt className="normalization-field__name">
                {FIELD_LABELS[field] ?? field}
                <span
                  className={`normalization-field__source normalization-field__source--${info.source}`}
                >
                  {SOURCE_LABELS[info.source] ?? info.source}
                </span>
                {info.confidence < LOW_CONFIDENCE_THRESHOLD && (
                  <span className="normalization-field__flag">Low confidence</span>
                )}
              </dt>
              {info.reasoning && (
                <dd className="normalization-field__reasoning">{info.reasoning}</dd>
              )}
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
