import { useState } from 'react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

interface Props {
  open: boolean
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
        Two files, one required and one optional. Reopen these notes any time with the
        Instructions button at the top of the page.
      </p>

      <section className="guide-step">
        <h3>
          <span className="guide-step__num">1</span> Inventory file (CSV/JSON, required)
        </h3>
        <ul>
          <li>
            <strong>CSV:</strong> one row per vehicle, with a header row naming each column.{' '}
            <strong>JSON:</strong> one object per vehicle, all inside a single array, with the same
            names as keys.
          </li>
          <li>
            Save as <strong>CSV (UTF-8)</strong> or as a <strong>UTF-8 JSON</strong> file. Excel's
            "Save As CSV" also works. A spreadsheet saved as .xlsx does not.
          </li>
          <li>
            Thirteen columns (JSON keys) are required: make, model, year, price, mileage, fuel
            type, transmission, colour, engine capacity, owners, district, condition and vehicle
            type.
          </li>
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
            A vehicle with no registration number in your file cannot be matched to photos. Add
            those from My listings instead.
          </li>
          <li>Photos for a registration number that is not in your file are skipped.</li>
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
