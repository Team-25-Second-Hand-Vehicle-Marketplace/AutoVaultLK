import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listUploads } from '../../api/admin.api'
import type { AdminUploadJob, UploadJobStatus } from '../../api/admin.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { Pill, type PillVariant } from '../../components/ui/Pill'
import { AdminTable } from '../../components/ui/AdminTable'
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

      <ErrorBanner message={error} />

      <AdminTable
        columns={['File', 'Status', 'Dealer', 'Records', 'Created']}
        rows={rows}
        loading={loading}
        loadingLabel="Loading uploads…"
        emptyLabel="No upload jobs found."
        renderRow={(row) => (
          <tr key={row.id}>
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
                <span className="admin-muted"> · {row.invalidRecords} invalid</span>
              ) : null}
            </td>
            <td>{formatDate(row.createdAt)}</td>
          </tr>
        )}
      />
    </div>
  )
}
