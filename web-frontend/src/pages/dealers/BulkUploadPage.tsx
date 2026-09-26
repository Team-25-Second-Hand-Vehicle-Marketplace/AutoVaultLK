import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toErrorMessage } from '../../api/client'
import { buildTemplateCsv, uploadInventory } from '../../api/ingestion.api'
import { COLUMN_HELP, TEMPLATE_HEADER, isRequired } from '../../api/ingestion.template'
import { KnownValuesReference } from '../../components/dealers/KnownValuesReference'
import { Button } from '../../components/ui/Button'
import { ErrorBanner } from '../../components/ui/ErrorBanner'

/** Matches INGESTION_MAX_UPLOAD_MB, so an oversize file fails here, not after the upload. */
const MAX_UPLOAD_MB = 25
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Rejects locally what the server would reject anyway.
 *
 * The extension check mirrors validateFile's; catching it before a 25 MB
 * transfer saves the dealer a slow round trip to learn they picked an .xlsx.
 */
function validateCsv(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    return `"${file.name}" is not a CSV. Export your inventory as CSV (UTF-8) and try again.`
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

  const [csv, setCsv] = useState<File | null>(null)
  const [zip, setZip] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const csvInput = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)

  const pickCsv = (file: File | null) => {
    setError(null)
    if (!file) return setCsv(null)

    const problem = validateCsv(file)
    if (problem) {
      setError(problem)
      setCsv(null)
      if (csvInput.current) csvInput.current.value = ''
      return
    }
    setCsv(file)
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
    const blob = new Blob([buildTemplateCsv()], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'autovault-inventory-template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!csv || uploading) return

    setUploading(true)
    setError(null)
    setProgress(0)

    try {
      const accepted = await uploadInventory(csv, zip, setProgress)
      // The pipeline runs asynchronously, so there is nothing to wait for here
      // — the status page polls from this point.
      navigate(`/dealer/uploads/${accepted.jobId}`, { replace: true })
    } catch (err) {
      setError(toErrorMessage(err, 'Upload failed. Please try again.'))
      setUploading(false)
    }
  }

  return (
    <div className="dealer-page">
      <header className="dealer-page__header">
        <h1>Bulk upload</h1>
        <p>Upload your inventory as a CSV, with an optional archive of photos.</p>
      </header>

      <ErrorBanner message={error} />

      <form className="upload-form" onSubmit={submit}>
        <section className="upload-card">
          <div className="upload-card__head">
            <h2>1. Inventory file</h2>
            <Button variant="ghost" size="sm" onClick={downloadTemplate}>
              Download template
            </Button>
          </div>

          <label className="upload-field" htmlFor="csv-input">
            <input
              id="csv-input"
              ref={csvInput}
              type="file"
              accept=".csv,text/csv"
              disabled={uploading}
              onChange={(e) => pickCsv(e.target.files?.[0] ?? null)}
            />
            <span className="upload-field__hint">
              {csv ? `${csv.name} · ${formatSize(csv.size)}` : 'Choose a CSV file (required)'}
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
          <Button type="submit" disabled={!csv || uploading}>
            {uploading ? 'Uploading…' : 'Upload inventory'}
          </Button>
        </div>
      </form>

      <KnownValuesReference />

      <section className="upload-card">
        <h2>Columns</h2>
        <p className="dealer-muted">
          Only the required columns must be present. Common header spellings are
          recognised automatically, so an export from your own system usually works
          unedited.
        </p>

        <div className="upload-columns">
          <table className="upload-columns__table">
            <thead>
              <tr>
                <th scope="col">Column</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {TEMPLATE_HEADER.map((column) => (
                <tr key={column}>
                  <th scope="row">
                    <code>{column}</code>
                    {isRequired(column) && <span className="upload-required"> required</span>}
                  </th>
                  <td>{COLUMN_HELP[column]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
