import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { searchAuditLogs } from '../../api/admin.api'
import type { AdminAuditLog } from '../../api/admin.types'
import { toErrorMessage } from '../../api/client'

function formatDate(value: string): string {
  return new Date(value).toLocaleString('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function toStartIso(date: string): string | undefined {
  if (!date) return undefined
  return new Date(`${date}T00:00:00`).toISOString()
}

function toEndIso(date: string): string | undefined {
  if (!date) return undefined
  return new Date(`${date}T23:59:59.999`).toISOString()
}

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

  const [rows, setRows] = useState<AdminAuditLog[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const data = await searchAuditLogs(
          {
            action: applied.action || undefined,
            entityType: applied.entityType || undefined,
            actorId: applied.actorId || undefined,
            from: toStartIso(applied.from),
            to: toEndIso(applied.to),
          },
          signal,
        )
        if (!signal?.aborted) setRows(data)
      } catch (err) {
        if (!signal?.aborted) {
          setError(toErrorMessage(err, 'Could not load audit logs.'))
        }
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [applied],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

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
        <button type="submit" className="button button--primary">
          Search
        </button>
      </form>

      {error && (
        <div className="form-error form-error--banner" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="admin-muted" role="status">
          Loading audit logs…
        </p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Actor</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="admin-table__empty">
                    No audit events match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.createdAt)}</td>
                    <td>
                      <span className="admin-pill">{row.action}</span>
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
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
