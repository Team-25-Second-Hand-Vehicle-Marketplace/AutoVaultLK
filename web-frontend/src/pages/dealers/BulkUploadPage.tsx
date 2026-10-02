import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toErrorMessage } from '../../api/client'
import { buildTemplate, getActiveJob, uploadInventory } from '../../api/ingestion.api'
import { UPLOAD_FORMATS } from '../../api/ingestion.template'
import type { UploadFileFormat } from '../../api/ingestion.types'
import { BulkUploadFieldsDialog } from '../../components/dealers/BulkUploadFieldsDialog'
import { BulkUploadGuide } from '../../components/dealers/BulkUploadGuide'
import { KnownValuesDialog } from '../../components/dealers/KnownValuesDialog'
import { Button } from '../../components/ui/Button'
import { ErrorBanner } from '../../components/ui/ErrorBanner'

/** Matches INGESTION_MAX_UPLOAD_MB, so an oversize file fails here, not after the upload. */
const MAX_UPLOAD_MB = 25
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

const GUIDE_DISMISSED_KEY = 'autovault.bulkUploadGuideDismissed'

// Storage can be unavailable (private windows, blocked site data); the guide
// then simply shows every visit, which is the safe direction to fail.
function guideDismissed(): boolean {
  try {
    return localStorage.getItem(GUIDE_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberGuideDismissed() {
  try {
    localStorage.setItem(GUIDE_DISMISSED_KEY, '1')
  } catch {
    /* nothing to do */
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const FORMATS = Object.keys(UPLOAD_FORMATS) as UploadFileFormat[]

/**
 * Rejects locally what the server would reject anyway.
 *
 * The extension check mirrors the server's: it must match the format the dealer
 * selected, and catching it before a 25 MB transfer saves a slow round trip to
 * learn they picked an .xlsx - or a .csv while JSON was selected.
 */
function validateInventory(file: File, format: UploadFileFormat): string | null {
  const wanted = UPLOAD_FORMATS[format]
  const name = file.name.toLowerCase()

  if (!name.endsWith(wanted.extension)) {
    const actual = FORMATS.find((other) => name.endsWith(UPLOAD_FORMATS[other].extension))
    if (actual) {
      return `You selected ${wanted.label}, but "${file.name}" is a ${UPLOAD_FORMATS[actual].label} file. Choose a ${wanted.extension} file, or switch the format to ${UPLOAD_FORMATS[actual].label}.`
    }
    return format === 'json'
      ? `"${file.name}" is not a JSON file. Export your inventory as a JSON array (UTF-8) and try again.`
      : `"${file.name}" is not a CSV. Export your inventory as CSV (UTF-8) and try again.`
  }
  if (file.size === 0) return 'That file is empty.'
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${formatSize(file.size)}; the limit is ${MAX_UPLOAD_MB} MB.`
  }
  return null
}

function validateZip(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    return `"${file.name}" is not a ZIP archive.`
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That archive is ${formatSize(file.size)}; the limit is ${MAX_UPLOAD_MB} MB.`
  }
  return null
}

export function BulkUploadPage() {
  const navigate = useNavigate()

  const [format, setFormat] = useState<UploadFileFormat>('csv')
  const [inventory, setInventory] = useState<File | null>(null)
  const [zip, setZip] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  // Gates the form so it never flashes before a redirect to an active job.
  const [checkingActive, setCheckingActive] = useState(true)
  // Opens on arrival unless the dealer opted out; the header button reopens it.
  const [guideOpen, setGuideOpen] = useState(() => !guideDismissed())
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [knownOpen, setKnownOpen] = useState(false)

  const inventoryInput = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)

  // A dealer who submitted, then navigated away while it was still
  // PENDING/PROCESSING, otherwise has no way back to that job's status short
  // of the URL they were on - this sends them straight there instead of a
  // blank form they could resubmit into.
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    getActiveJob(controller.signal).then(
      (active) => {
        if (cancelled) return
        if (active) {
          navigate(`/dealer/uploads/${active.id}`, { replace: true })
          return
        }
        setCheckingActive(false)
      },
      () => {
        // A failed check should not block uploading a new file - worst case
        // the dealer double-submits, which the pipeline already tolerates.
        if (!cancelled) setCheckingActive(false)
      },
    )

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [navigate])

  const pickInventory = (file: File | null) => {
    setError(null)
    if (!file) return setInventory(null)

    const problem = validateInventory(file, format)
    if (problem) {
      setError(problem)
      setInventory(null)
      if (inventoryInput.current) inventoryInput.current.value = ''
      return
    }
    setInventory(file)
  }

  // A file chosen under one format is wrong under the other, so switching
  // clears it rather than leaving a stale selection that would fail on submit.
  const chooseFormat = (next: UploadFileFormat) => {
    if (next === format) return
    setFormat(next)
    setInventory(null)
    setError(null)
    if (inventoryInput.current) inventoryInput.current.value = ''
  }

  const pickZip = (file: File | null) => {
    setError(null)
    if (!file) return setZip(null)

    const problem = validateZip(file)
    if (problem) {
      setError(problem)
      setZip(null)
      if (zipInput.current) zipInput.current.value = ''
      return
    }
    setZip(file)
  }

  const downloadTemplate = () => {
    const blob = new Blob([buildTemplate(format)], { type: UPLOAD_FORMATS[format].mime })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = UPLOAD_FORMATS[format].templateFileName
    link.click()
    URL.revokeObjectURL(url)
  }

  const closeGuide = (dontShowAgain: boolean) => {
    if (dontShowAgain) rememberGuideDismissed()
    setGuideOpen(false)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!inventory || uploading) return

    setUploading(true)
    setError(null)
    setProgress(0)

    try {
      const accepted = await uploadInventory(format, inventory, zip, setProgress)
      // The pipeline runs asynchronously, so there is nothing to wait for here
      // - the status page polls from this point.
      navigate(`/dealer/uploads/${accepted.jobId}`, { replace: true })
    } catch (err) {
      setError(toErrorMessage(err, 'Upload failed. Please try again.'))
      setUploading(false)
    }
  }

  if (checkingActive) {
    return (
      <div className="dealer-page">
        <p className="dealer-muted" role="status">
          Checking for an upload already in progress…
        </p>
      </div>
    )
  }

  return (
    <div className="dealer-page">
      <header className="dealer-page__header dealer-page__header--split">
        <div>
          <h1>Bulk upload</h1>
          <p>Upload your inventory as a CSV or JSON file, with an optional archive of photos.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setGuideOpen(true)}>
          Instructions
        </Button>
      </header>

      <ErrorBanner message={error} />

      <form className="upload-form" onSubmit={submit}>
        <section className="upload-card">
          <div className="upload-card__head">
            <h2>1. Inventory file</h2>
            <div className="upload-card__tools">
              <Button variant="ghost" size="sm" onClick={() => setFieldsOpen(true)}>
                View fields
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setKnownOpen(true)}>
                Known makes &amp; models
              </Button>
              <Button variant="ghost" size="sm" onClick={downloadTemplate}>
                Download template
              </Button>
            </div>
          </div>

          <fieldset className="upload-format" disabled={uploading}>
            <legend>File format</legend>
            {FORMATS.map((option) => (
              <label key={option} className="upload-format__option">
                <input
                  type="radio"
                  name="inventory-format"
                  value={option}
                  checked={format === option}
                  onChange={() => chooseFormat(option)}
                />
                {UPLOAD_FORMATS[option].label}
              </label>
            ))}
          </fieldset>

          <label className="upload-field" htmlFor="file-input">
            <input
              id="file-input"
              ref={inventoryInput}
              type="file"
              accept={UPLOAD_FORMATS[format].accept}
              disabled={uploading}
              onChange={(e) => pickInventory(e.target.files?.[0] ?? null)}
            />
            <span className="upload-field__hint">
              {inventory
                ? `${inventory.name} · ${formatSize(inventory.size)}`
                : `Choose a ${UPLOAD_FORMATS[format].label} file (required)`}
            </span>
          </label>
        </section>

        <section className="upload-card">
          <h2>2. Photos (optional)</h2>
          <p className="dealer-muted">
            A ZIP of images named after each vehicle's registration number, e.g.
            <code> CAB-1234_1.jpg</code>. Vehicles without a registration number cannot be
            matched to photos.
          </p>

          <label className="upload-field" htmlFor="zip-input">
            <input
              id="zip-input"
              ref={zipInput}
              type="file"
              accept=".zip,application/zip"
              disabled={uploading}
              onChange={(e) => pickZip(e.target.files?.[0] ?? null)}
            />
            <span className="upload-field__hint">
              {zip ? `${zip.name} · ${formatSize(zip.size)}` : 'Choose a ZIP archive'}
            </span>
          </label>
        </section>

        {uploading && (
          <div className="upload-progress" role="status" aria-live="polite">
            <div className="upload-progress__bar">
              <div className="upload-progress__fill" style={{ width: `${progress}%` }} />
            </div>
            <span>{progress < 100 ? `Uploading… ${progress}%` : 'Processing…'}</span>
          </div>
        )}

        <div className="dealer-page__actions">
          <Button type="submit" disabled={!inventory || uploading}>
            {uploading ? 'Uploading…' : 'Upload inventory'}
          </Button>
        </div>
      </form>

      <BulkUploadGuide
        open={guideOpen}
        format={format}
        onClose={closeGuide}
        onViewFields={() => setFieldsOpen(true)}
        onViewKnown={() => setKnownOpen(true)}
        onDownloadTemplate={downloadTemplate}
      />
      <BulkUploadFieldsDialog
        open={fieldsOpen}
        format={format}
        onClose={() => setFieldsOpen(false)}
      />
      <KnownValuesDialog open={knownOpen} onClose={() => setKnownOpen(false)} />
    </div>
  )
}
