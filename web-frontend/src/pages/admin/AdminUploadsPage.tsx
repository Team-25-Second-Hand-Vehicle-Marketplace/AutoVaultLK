import { Fragment, useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getUploadRejections, listUploads } from '../../api/admin.api'
import type { AdminUploadJob, UploadJobStatus } from '../../api/admin.types'
import type { RejectionsPage } from '../../api/ingestion.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { Pill, type PillVariant } from '../../components/ui/Pill'
import { AdminTable } from '../../components/ui/AdminTable'
import { RejectionsReport } from '../../components/dealers/RejectionsReport'
import { formatDate } from '../../utils/format'

const STATUSES: Array<UploadJobStatus | ''> = [
  '',
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'PARTIAL',
]

function statusVariant(status: string): PillVariant {
  if (status === 'COMPLETED') return 'ok'
  if (status === 'FAILED' || status === 'PARTIAL') return 'danger'
  if (status === 'PROCESSING' || status === 'PENDING') return 'warn'
  return 'neutral'
}

const uploadsError = (err: unknown) => toErrorMessage(err, 'Could not load uploads.')
const rejectionsError = (err: unknown) => toErrorMessage(err, 'Could not load the skipped rows.')

export function AdminUploadsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status') ?? ''
  const status = (STATUSES.includes(statusParam as UploadJobStatus | '')
    ? statusParam
    : '') as UploadJobStatus | ''

  const fetchUploads = useCallback(
    (signal: AbortSignal) => listUploads(status || undefined, signal),
    [status],
  )
  const { data, error, loading } = useAsyncData<AdminUploadJob[]>(fetchUploads, uploadsError,
  )
  const rows = data ?? []

  // Only one job's rejections are ever shown at a time. useAsyncData, not a
  // hand-rolled effect: refetching-on-key-change with a signal, an abort on
  // cleanup, and a loading state that doesn't flash-set synchronously is
  // exactly what it already does correctly elsewhere in this app.
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const fetchRejections = useCallback(
    (signal: AbortSignal) =>
      expandedJobId ? getUploadRejections(expandedJobId, 1, signal) : Promise.resolve(null),
    [expandedJobId],
  )
  const rejectionsState = useAsyncData<RejectionsPage | null>(fetchRejections, rejectionsError)

  const toggleExpanded = (jobId: string) => {
    setExpandedJobId((current) => (current === jobId ? null : jobId))
  }

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <h1>Uploads</h1>
        <p>Bulk upload jobs across all dealers.</p>
      </header>

      <div className="admin-toolbar">
        <label className="admin-toolbar__field">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              const next = e.target.value
              if (next) setSearchParams({ status: next })
              else setSearchParams({})
            }}
          >
            <option value="">All</option>
            {STATUSES.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorBanner message={error} />

      <AdminTable
        columns={['File', 'Status', 'Dealer', 'Records', 'Created']}
        rows={rows}
        loading={loading}
        loadingLabel="Loading uploads…"
        emptyLabel="No upload jobs found."
        renderRow={(row) => (
          <Fragment key={row.id}>
            <tr>
              <td>
                <div>{row.fileName}</div>
                <span className="admin-muted admin-mono">{row.id}</span>
              </td>
              <td>
                <Pill variant={statusVariant(row.status)}>{row.status}</Pill>
              </td>
              <td>
                <span className="admin-mono">{row.dealerId}</span>
              </td>
              <td>
                {row.validRecords}/{row.totalRecords}
                {row.invalidRecords > 0 ? (
                  <>
                    <span className="admin-muted"> · {row.invalidRecords} invalid</span>{' '}
                    <button
                      type="button"
                      className="admin-card__link admin-link-button"
                      onClick={() => toggleExpanded(row.id)}
                    >
                      {expandedJobId === row.id ? 'Hide reasons' : 'View reasons'}
                    </button>
                  </>
                ) : null}
              </td>
              <td>{formatDate(row.createdAt)}</td>
            </tr>
            {expandedJobId === row.id && (
              <tr>
                <td colSpan={5} className="admin-table__expanded">
                  <RejectionsReport
                    rows={rejectionsState.data?.items ?? []}
                    total={rejectionsState.data?.total ?? 0}
                    skippedCount={row.invalidRecords}
                    loading={rejectionsState.loading}
                    error={rejectionsState.error}
                  />
                </td>
              </tr>
            )}
          </Fragment>
        )}
      />
    </div>
  )
}
