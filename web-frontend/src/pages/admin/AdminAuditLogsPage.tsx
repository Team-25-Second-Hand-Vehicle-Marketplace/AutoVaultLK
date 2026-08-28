import { useCallback, useState, type FormEvent } from 'react'
import { searchAuditLogs } from '../../api/admin.api'
import type { AdminAuditLog } from '../../api/admin.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { Button } from '../../components/ui/Button'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { Pill } from '../../components/ui/Pill'
import { AdminTable } from '../../components/ui/AdminTable'
import { formatDate } from '../../utils/format'

function toStartIso(date: string): string | undefined {
  if (!date) return undefined
  return new Date(`${date}T00:00:00`).toISOString()
}

function toEndIso(date: string): string | undefined {
  if (!date) return undefined
  return new Date(`${date}T23:59:59.999`).toISOString()
}

const auditError = (err: unknown) => toErrorMessage(err, 'Could not load audit logs.')

export function AdminAuditLogsPage() {
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [actorId, setActorId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [applied, setApplied] = useState({
    action: '',
    entityType: '',
    actorId: '',
    from: '',
    to: '',
  })

  const fetchLogs = useCallback(
    (signal: AbortSignal) =>
      searchAuditLogs(
        {
          action: applied.action || undefined,
          entityType: applied.entityType || undefined,
          actorId: applied.actorId || undefined,
          from: toStartIso(applied.from),
          to: toEndIso(applied.to),
        },
        signal,
      ),
    [applied],
  )
  const { data, error, loading } = useAsyncData<AdminAuditLog[]>(fetchLogs, auditError,
  )
  const rows = data ?? []

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    setApplied({ action, entityType, actorId, from, to })
  }

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <h1>Audit logs</h1>
        <p>Search administrative actions (latest 200).</p>
      </header>

      <form className="admin-toolbar admin-toolbar--wrap" onSubmit={onSearch}>
        <label className="admin-toolbar__field">
          <span>Action</span>
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="e.g. DEALER_APPROVED"
          />
        </label>
        <label className="admin-toolbar__field">
          <span>Entity type</span>
          <input
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="e.g. dealer"
          />
        </label>
        <label className="admin-toolbar__field">
          <span>Actor ID</span>
          <input
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            placeholder="UUID"
          />
        </label>
        <label className="admin-toolbar__field">
          <span>From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="admin-toolbar__field">
          <span>To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button type="submit">Search</Button>
      </form>

      <ErrorBanner message={error} />

      <AdminTable
        columns={['When', 'Action', 'Entity', 'Actor', 'IP']}
        rows={rows}
        loading={loading}
        loadingLabel="Loading audit logs…"
        emptyLabel="No audit events match these filters."
        renderRow={(row) => (
          <tr key={row.id}>
            <td>{formatDate(row.createdAt)}</td>
            <td>
              <Pill>{row.action}</Pill>
            </td>
            <td>
              <div>
                {row.entityType}
                {row.entityId ? (
                  <span className="admin-muted"> · {row.entityId.slice(0, 8)}…</span>
                ) : null}
              </div>
            </td>
            <td>
              <span className="admin-mono">{row.actorId ?? '—'}</span>
            </td>
            <td>{row.ipAddress ?? '—'}</td>
          </tr>
        )}
      />
    </div>
  )
}
