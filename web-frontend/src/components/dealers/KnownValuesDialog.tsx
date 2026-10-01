import { useCallback } from 'react'
import { getSearchOptions } from '../../api/search.api'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

const optionsError = (err: unknown) => toErrorMessage(err, 'Could not load the reference list.')

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * The makes, models and values the pipeline recognises. A dealer typing these
 * into a spreadsheet has no other way to know what will be accepted until the
 * upload comes back with rows rejected for "make could not be recognised", so
 * this puts the same reference data the manual listing form already constrains
 * a dealer to (GET /search/options, which the public search sidebar uses too)
 * one click away from the upload page.
 *
 * Mounted only while open, so the list - a few hundred rows - is fetched when a
 * dealer actually asks for it rather than on every visit to the page.
 */
function KnownValuesBody() {
  const fetchOptions = useCallback((signal: AbortSignal) => getSearchOptions(undefined, signal), [])
  const options = useAsyncData(fetchOptions, optionsError)

  return (
    <div className="known-values">
      <p className="dealer-muted">
        Check spelling before uploading. An unrecognised make or model is rejected, not guessed.
        Misspellings close to one of these are corrected automatically.
      </p>

      {options.loading && (
        <p className="dealer-muted" role="status">
          Loading…
        </p>
      )}

      {!options.loading && options.error && (
        <p className="dealer-muted" role="alert">
          {options.error}
        </p>
      )}

      {!options.loading && options.data && (
        <>
          <div className="known-values__group">
            <h3>Vehicle type</h3>
            <p>{options.data.vehicleTypes.join(', ')}</p>
          </div>

          <div className="known-values__group">
            <h3>Condition</h3>
            <p>{options.data.conditions.join(', ')}</p>
          </div>

          <div className="known-values__group">
            <h3>Fuel type</h3>
            <p>{options.data.fuelTypes.join(', ')}</p>
          </div>

          <div className="known-values__group">
            <h3>Transmission</h3>
            <p>{options.data.transmissionTypes.join(', ')}</p>
          </div>

          <div className="known-values__group">
            <h3>Body type</h3>
            <p>{options.data.bodyTypes.join(', ')}</p>
          </div>

          <div className="known-values__group">
            <h3>District</h3>
            <p>{options.data.districts.join(', ')}</p>
          </div>

          <div className="known-values__group">
            <h3>Make and model</h3>
            <dl className="known-values__makes">
              {options.data.makes.map((make) => (
                <div key={make.id} className="known-values__make">
                  <dt>{make.name}</dt>
                  <dd>{make.models.map((model) => model.name).join(', ')}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
    </div>
  )
}

export function KnownValuesDialog({ open, onClose }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Known makes, models and values"
      size="lg"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <KnownValuesBody />
    </Modal>
  )
}
