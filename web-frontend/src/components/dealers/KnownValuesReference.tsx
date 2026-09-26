import { useCallback, useId, useState } from 'react'
import { getSearchOptions } from '../../api/search.api'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'

/**
 * A dealer typing make/model/vehicle_type/condition into a spreadsheet has no
 * way to know what the pipeline will actually recognise until the upload
 * comes back with rows rejected for "make could not be recognised" — the
 * same makes/models/enums the manual listing form already constrains a
 * dealer to, bulk upload only checks after the fact. This surfaces the same
 * reference data (GET /search/options, which the public search sidebar
 * already uses) on the Bulk Upload page itself, before that first failed
 * attempt.
 *
 * Collapsed by default and fetched lazily — most dealers uploading a file
 * they have used before don't need this every time, and the makes/models
 * list is a few hundred rows not worth loading unconditionally.
 */
export function KnownValuesReference() {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  const fetchOptions = useCallback((signal: AbortSignal) => getSearchOptions(undefined, signal), [])
  const options = useAsyncData(fetchOptions, (err) =>
    toErrorMessage(err, 'Could not load the reference list.'),
  )

  return (
    <section className="upload-card">
      <button
        type="button"
        className="listing-details__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide' : 'Show'} known makes, models & values
      </button>

      {open && (
        <div id={panelId} className="known-values">
          <p className="dealer-muted">
            Check spelling before uploading — an unrecognised make or model is rejected, not
            guessed. Misspellings close to one of these are corrected automatically.
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
                <h3>vehicle_type</h3>
                <p>{options.data.vehicleTypes.join(', ')}</p>
              </div>

              <div className="known-values__group">
                <h3>condition</h3>
                <p>{options.data.conditions.join(', ')}</p>
              </div>

              <div className="known-values__group">
                <h3>fuel_type</h3>
                <p>{options.data.fuelTypes.join(', ')}</p>
              </div>

              <div className="known-values__group">
                <h3>transmission</h3>
                <p>{options.data.transmissionTypes.join(', ')}</p>
              </div>

              <div className="known-values__group">
                <h3>body_type</h3>
                <p>{options.data.bodyTypes.join(', ')}</p>
              </div>

              <div className="known-values__group">
                <h3>location_district</h3>
                <p>{options.data.districts.join(', ')}</p>
              </div>

              <div className="known-values__group">
                <h3>make &amp; model</h3>
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
      )}
    </section>
  )
}
