import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getMyUploadJobs } from '../../api/ingestion.api'
import type { JobsPage, UploadJobStatus } from '../../api/ingestion.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { ErrorBanner } from '../../components/ui/ErrorBanner'

/**
 * Every bulk upload the dealer has ever submitted, newest first — the page
 * that lets a dealer find their way back to a past job's rejection report.
 * Before this existed, that report was only reachable from the URL right
 * after the upload finished: navigate away, and it was gone for good even
 * though the rows and reasons were still sitting in the database.
 */

const STATUS_LABEL: Record<UploadJobStatus, string> = {
  PENDING: 'Queued',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  PARTIAL: 'Completed with skipped rows',
  FAILED: 'Failed',
}

const jobsError = (err: unknown) => toErrorMessage(err, 'Could not load your upload history.')

export function UploadHistoryPage() {
  const fetchJobs = useCallback((signal: AbortSignal) => getMyUploadJobs(1, signal), [])
  const jobs = useAsyncData<JobsPage>(fetchJobs, jobsError)

  return (
    <div className="dealer-page">
      <header className="dealer-page__header">
        <h1>Upload history</h1>
        <p>Every bulk upload you've submitted, and the rows that were skipped in each one.</p>
      </header>

      {jobs.loading && (
        <p className="dealer-muted" role="status">
          Loading upload history…
        </p>
      )}

      {!jobs.loading && jobs.error && <ErrorBanner message={jobs.error} />}

      {!jobs.loading && !jobs.error && jobs.data?.items.length === 0 && (
        <div className="empty-state">
          <p>You haven't submitted a bulk upload yet.</p>
          <p className="empty-state__detail">
            <Link to="/dealer/upload">Start a bulk upload</Link> to add your inventory all at
            once.
          </p>
        </div>
      )}

      {!jobs.loading && !jobs.error && (jobs.data?.items.length ?? 0) > 0 && (
        <div className="listing-table-wrap">
          <table className="listing-table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Uploaded</th>
                <th scope="col">Status</th>
                <th scope="col">Rows loaded</th>
                <th scope="col">Rows skipped</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.data!.items.map((job) => (
                <tr key={job.id}>
                  <th scope="row">{job.fileName}</th>
                  <td>{new Date(job.createdAt).toLocaleString()}</td>
                  <td>{STATUS_LABEL[job.status]}</td>
                  <td>{job.validRecords}</td>
                  <td>{job.invalidRecords}</td>
                  <td className="listing-table__actions">
                    <Link className="button button--ghost button--sm" to={`/dealer/uploads/${job.id}`}>
                      View details
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {jobs.data && jobs.data.total > jobs.data.items.length && (
            <p className="dealer-muted">
              Showing the {jobs.data.items.length} most recent uploads of {jobs.data.total}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
