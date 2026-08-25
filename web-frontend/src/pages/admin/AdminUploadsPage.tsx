import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listUploads } from '../../api/admin.api'
import type { AdminUploadJob, UploadJobStatus } from '../../api/admin.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'

const STATUSES: Array<UploadJobStatus | ''> = [
  '',
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'PARTIAL',
]

function formatDate(value: string): string {
  return new Date(value).toLocaleString('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function statusClass(status: string): string {
  if (status === 'COMPLETED') return 'admin-pill admin-pill--ok'
  if (status === 'FAILED' || status === 'PARTIAL') return 'admin-pill admin-pill--danger'
  if (status === 'PROCESSING' || status === 'PENDING') return 'admin-pill admin-pill--warn'
  return 'admin-pill'
}

const uploadsError = (err: unknown) => toErrorMessage(err, 'Could not load uploads.')

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

      {error && (
        <div className="form-error form-error--banner" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="admin-muted" role="status">
          Loading uploads…
        </p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Dealer</th>
                <th>Records</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="admin-table__empty">
                    No upload jobs found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div>{row.fileName}</div>
                      <span className="admin-muted admin-mono">{row.id}</span>
                    </td>
                    <td>
                      <span className={statusClass(row.status)}>{row.status}</span>
                    </td>
                    <td>
                      <span className="admin-mono">{row.dealerId}</span>
                    </td>
                    <td>
                      {row.validRecords}/{row.totalRecords}
                      {row.invalidRecords > 0 ? (
                        <span className="admin-muted"> · {row.invalidRecords} invalid</span>
                      ) : null}
                    </td>
                    <td>{formatDate(row.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
