import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toErrorMessage } from '../../api/client'
import { getJobRejections, getJobStatus } from '../../api/ingestion.api'
import {
  isTerminal,
  type JobStatus,
  type RejectedRecord,
  type UploadJobStatus,
} from '../../api/ingestion.types'
import { RejectionsReport } from '../../components/dealers/RejectionsReport'
import { ErrorBanner } from '../../components/ui/ErrorBanner'

const POLL_START_MS = 2000
const POLL_MAX_MS = 15000
/** Each poll waits a little longer, so a slow job stops hammering the gateway. */
const POLL_BACKOFF = 1.4

/**
 * PARTIAL is a success, and saying so matters: it means the file had some bad
 * rows, not that the upload failed. A dealer who reads it as an error
 * re-uploads the whole file and creates duplicate work for themselves.
 */
const STATUS_COPY: Record<UploadJobStatus, { label: string; tone: string; detail: string }> = {
  PENDING: {
    label: 'Queued',
    tone: 'is-pending',
    detail: 'Your file has been received and is waiting to be processed.',
  },
  PROCESSING: {
    label: 'Processing',
    tone: 'is-pending',
    detail: 'Reading your file, matching makes and models, and preparing listings.',
  },
  COMPLETED: {
    label: 'Completed',
    tone: 'is-success',
    detail: 'Every row was loaded. Your listings are awaiting review before going live.',
  },
  PARTIAL: {
    label: 'Completed with skipped rows',
    tone: 'is-warning',
    detail:
      'Your valid rows were loaded. The rest were skipped — fix them in your file and upload just those rows.',
  },
  FAILED: {
    label: 'Failed',
    tone: 'is-danger',
    detail:
      'Nothing could be loaded. The file may be missing required columns, or every row may have been invalid.',
  },
}

export function UploadStatusPage() {
  const { jobId } = useParams<{ jobId: string }>()

  const [job, setJob] = useState<JobStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [rejections, setRejections] = useState<RejectedRecord[]>([])
  const [rejectionsTotal, setRejectionsTotal] = useState(0)
  const [rejectionsError, setRejectionsError] = useState<string | null>(null)
  const [rejectionsLoading, setRejectionsLoading] = useState(false)

  // Held in refs so the polling effect does not restart on every tick.
  const delay = useRef(POLL_START_MS)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!jobId) return

    const controller = new AbortController()
    let cancelled = false

    const poll = async () => {
      try {
        const next = await getJobStatus(jobId, controller.signal)
        if (cancelled) return

        setJob(next)
        setError(null)
        setLoading(false)

        // Terminal means the job will never change again; polling on would be
        // pure noise against the gateway.
        if (isTerminal(next.status)) return

        delay.current = Math.min(delay.current * POLL_BACKOFF, POLL_MAX_MS)
        timer.current = window.setTimeout(poll, delay.current)
      } catch (err) {
        if (cancelled || controller.signal.aborted) return

        setError(toErrorMessage(err, 'Could not load this upload.'))
        setLoading(false)
        // Keep polling through a transient failure — the job itself is still
        // running, and a dropped request should not strand the page.
        delay.current = Math.min(delay.current * POLL_BACKOFF, POLL_MAX_MS)
        timer.current = window.setTimeout(poll, delay.current)
      }
    }

    void poll()

    return () => {
      cancelled = true
      controller.abort()
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [jobId])

  // Rejections are fetched once, after the job settles. Fetching them while
  // the pipeline is still running would show a partial list that grows under
  // the dealer as stages report in; `settled` is the same terminal check the
  // poll loop stops on, so this fires exactly once per job.
  useEffect(() => {
    if (!jobId || !job || !isTerminal(job.status) || job.invalidRecords === 0) return

    const controller = new AbortController()
    let cancelled = false

    const load = async () => {
      setRejectionsLoading(true)
      try {
        const page = await getJobRejections(jobId, 1, controller.signal)
        if (cancelled) return
        setRejections(page.items)
        setRejectionsTotal(page.total)
        setRejectionsError(null)
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        // The counts above still stand on their own, so a failed report is a
        // degraded page, not a broken one.
        setRejectionsError(toErrorMessage(err, 'Could not load the skipped rows.'))
      } finally {
        if (!cancelled) setRejectionsLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [jobId, job])

  if (!jobId) {
    return (
      <div className="dealer-page">
        <ErrorBanner message="No upload was specified." />
      </div>
    )
  }

  if (loading && !job) {
    return (
      <div className="dealer-page">
        <p className="dealer-muted" role="status">
          Loading upload…
        </p>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="dealer-page">
        <ErrorBanner message={error ?? 'This upload could not be found.'} />
        <div className="dealer-page__actions">
          <Link className="button button--ghost" to="/dealer/upload">
            Back to bulk upload
          </Link>
        </div>
      </div>
    )
  }

  const copy = STATUS_COPY[job.status]
  const settled = isTerminal(job.status)
  // total_records is written before fan-out, so it can legitimately be 0 while
  // the job is still being split.
  const processed = job.validRecords + job.invalidRecords

  return (
    <div className="dealer-page">
      <header className="dealer-page__header">
        <h1>{job.fileName}</h1>
        <p>Uploaded {new Date(job.createdAt).toLocaleString()}</p>
      </header>

      {error && <ErrorBanner message={error} />}

      <section className={`upload-status ${copy.tone}`} role="status" aria-live="polite">
        <div className="upload-status__head">
          <span className="upload-status__label">{copy.label}</span>
          {!settled && <span className="upload-status__spinner" aria-hidden="true" />}
        </div>
        <p>{copy.detail}</p>
      </section>

      <div className="dealer-tiles">
        <div className="dealer-tiles__item">
          <span className="dealer-tiles__label">Rows in file</span>
          <span className="dealer-tiles__value">{job.totalRecords}</span>
        </div>
        <div className="dealer-tiles__item">
          <span className="dealer-tiles__label">Listings created</span>
          <span className="dealer-tiles__value">{job.validRecords}</span>
        </div>
        <div className="dealer-tiles__item">
          <span className="dealer-tiles__label">Rows skipped</span>
          <span className="dealer-tiles__value">{job.invalidRecords}</span>
        </div>
      </div>

      {!settled && job.totalRecords > 0 && (
        <div className="upload-progress">
          <div className="upload-progress__bar">
            <div
              className="upload-progress__fill"
              style={{ width: `${Math.round((processed / job.totalRecords) * 100)}%` }}
            />
          </div>
          <span>
            {processed} of {job.totalRecords} rows processed
          </span>
        </div>
      )}

      {settled && job.invalidRecords > 0 && (
        <RejectionsReport
          rows={rejections}
          total={rejectionsTotal}
          skippedCount={job.invalidRecords}
          loading={rejectionsLoading}
          error={rejectionsError}
        />
      )}

      {job.validRecords > 0 && (
        <section className="upload-card">
          <h2>Your new listings</h2>
          <p className="dealer-muted">
            {job.validRecords} listing{job.validRecords === 1 ? '' : 's'} were created and
            are awaiting review. They appear on your dashboard under “Pending review”.
          </p>
          <div className="dealer-page__actions">
            <Link className="button button--ghost" to="/dealer">
              Go to dashboard
            </Link>
          </div>
        </section>
      )}

      <div className="dealer-page__actions">
        <Link className="button button--ghost" to="/dealer/upload">
          Upload another file
        </Link>
      </div>
    </div>
  )
}
