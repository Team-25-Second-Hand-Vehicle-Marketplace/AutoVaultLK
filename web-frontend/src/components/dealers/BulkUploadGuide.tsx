import { useState } from 'react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import type { UploadFileFormat } from '../../api/ingestion.types'

interface Props {
  open: boolean
  /** The format the dealer chose; step 1 describes that format's file. */
  format?: UploadFileFormat
  /** `dontShowAgain` reflects the checkbox at the moment the guide was closed. */
  onClose: (dontShowAgain: boolean) => void
  /** Opens the columns dialog; the guide closes first so the two never stack. */
  onViewFields: () => void
  onViewKnown: () => void
  onDownloadTemplate: () => void
}

/**
 * Step-by-step preparation notes for a bulk upload. Shown on arrival until the
 * dealer opts out (a dealer who uploads every week does not need it each time)
 * and reopenable from the page header at any point.
 */
export function BulkUploadGuide({
  open,
  format = 'csv',
  onClose,
  onViewFields,
  onViewKnown,
  onDownloadTemplate,
}: Props) {
  const [dontShowAgain, setDontShowAgain] = useState(false)

  return (
    <Modal
      open={open}
      onClose={() => onClose(dontShowAgain)}
      title="How to prepare your upload"
      size="lg"
      footer={
        <>
          <label className="modal__check">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            Don't show this again
          </label>
          <Button onClick={() => onClose(dontShowAgain)}>Got it</Button>
        </>
      }
    >
      <p className="dealer-muted">
        Two files, one required (a CSV or a JSON inventory file) and one optional (a ZIP of photos).
        Pick the format at the top of the page. Reopen these notes any time with the
        Instructions button at the top of the page.
      </p>

      <section className="guide-step">
        <h3>
          <span className="guide-step__num">1</span> Inventory file (
          {format === 'json' ? 'JSON' : 'CSV'}, required)
        </h3>
        <ul>
          {format === 'json' ? (
            <>
              <li>
                One flat object per vehicle, all inside a single array:{' '}
                <code>[ {'{ "make": "Toyota", … }'}, {'{ … }'} ]</code>. Download the template to
                see it.
              </li>
              <li>
                Save as <strong>UTF-8</strong> with a <code>.json</code> extension. Numbers can be
                written as numbers (<code>2018</code>) or as text.
              </li>
              <li>
                Keep every field flat. Nested objects and lists are not accepted: write{' '}
                <code>"sunroof": true</code>, not <code>"specs": {'{ … }'}</code>.
              </li>
              <li>
                The field names are the same as the CSV columns, and the same thirteen are required
                on every vehicle: make, model, year, price, mileage, fuel type, transmission,
                colour, engine capacity, owners, district, condition and vehicle type. Use{' '}
                <code>null</code> or leave a field out when you do not have the value.
              </li>
            </>
          ) : (
            <>
              <li>One row per vehicle, with a header row naming each column.</li>
              <li>
                Save as <strong>CSV (UTF-8)</strong>. Excel's "Save As CSV" also works. A
                spreadsheet saved as .xlsx does not.
              </li>
              <li>
                Thirteen columns are required: make, model, year, price, mileage, fuel type,
                transmission, colour, engine capacity, owners, district, condition and vehicle
                type.
              </li>
            </>
          )}
          <li>
            Check make and model spelling with the Known makes &amp; models button. Close
            misspellings are corrected, but an unrecognised make or model is rejected.
          </li>
          <li>Prices and mileage are forgiving: "Rs. 3,500,000", "3.5M" and "45,000 km" all work.</li>
          <li>Up to 25 MB.</li>
        </ul>
        <div className="guide-step__actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onClose(dontShowAgain)
              onViewFields()
            }}
          >
            View fields
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onClose(dontShowAgain)
              onViewKnown()
            }}
          >
            Known makes &amp; models
          </Button>
          <Button variant="ghost" size="sm" onClick={onDownloadTemplate}>
            Download template
          </Button>
        </div>
      </section>

      <section className="guide-step">
        <h3>
          <span className="guide-step__num">2</span> Photos (ZIP, optional)
        </h3>
        <ul>
          <li>
            Name each photo after the vehicle's <strong>registration number</strong>, for example{' '}
            <code>CAB-1234.jpg</code>. Add <code>_2</code>, <code>_3</code> and so on for more
            photos of the same vehicle (<code>CAB-1234_2.jpg</code>).
          </li>
          <li>JPG, PNG or WebP. Up to 2,000 photos and 25 MB in the archive.</li>
          <li>
            A vehicle with no registration number in the {format === 'json' ? 'JSON file' : 'CSV'}{' '}
            cannot be matched to photos. Add those from My listings instead.
          </li>
          <li>
            Photos for a registration number that is not in your {format === 'json' ? 'JSON file' : 'CSV'}{' '}
            are skipped.
          </li>
        </ul>
      </section>

      <section className="guide-step">
        <h3>
          <span className="guide-step__num">3</span> After you upload
        </h3>
        <ul>
          <li>Processing takes from a few seconds to several minutes, depending on the size.</li>
          <li>
            Rows with a problem are skipped, not the whole file. You get a report of exactly which
            rows and why, so you can fix and upload just those.
          </li>
          <li>
            Imported vehicles arrive as <strong>pending review</strong>. Check them in My
            listings, then approve to publish.
          </li>
        </ul>
      </section>
    </Modal>
  )
}
