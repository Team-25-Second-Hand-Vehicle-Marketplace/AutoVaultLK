import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDashboard } from '../../api/admin.api'
import type { AdminDashboard } from '../../api/admin.types'
import { toErrorMessage } from '../../api/client'

function statusCount(byStatus: Record<string, number>, keys: string[]): number {
  return keys.reduce((sum, key) => sum + (byStatus[key] ?? 0), 0)
}

export function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    getDashboard(controller.signal)
      .then(setData)
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(toErrorMessage(err, 'Could not load dashboard.'))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  if (loading) {
    return (
      <div className="admin-page">
        <p className="admin-muted" role="status">
          Loading dashboard…
        </p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="admin-page">
        <div className="form-error form-error--banner" role="alert">
          {error ?? 'No data'}
        </div>
      </div>
    )
  }

  const inProgress = statusCount(data.uploads.byStatus, ['PENDING', 'PROCESSING'])
  const failures = statusCount(data.uploads.byStatus, ['FAILED', 'PARTIAL'])

  const tiles = [
    { label: 'Live listings', value: data.listings.live, to: undefined },
    { label: 'Pending dealer approvals', value: data.users.pendingDealers, to: '/admin/users?tab=pending' },
    { label: 'Uploads in progress', value: inProgress, to: '/admin/uploads' },
    { label: 'Upload failures', value: failures, to: '/admin/uploads?status=FAILED' },
    { label: 'Total users', value: data.users.total, to: '/admin/users' },
    { label: 'Dealers', value: data.users.dealers, to: undefined },
    {
      label: 'Notification delivery',
      value: `${(data.notifications.deliveryRate * 100).toFixed(1)}%`,
      hint: `${data.notifications.sent} sent · ${data.notifications.failed} failed`,
      to: undefined,
    },
    {
      label: 'Audit events (24h)',
      value: data.audit.recentCount,
      to: '/admin/audit-logs',
    },
  ] as const

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <h1>Dashboard</h1>
        <p>Marketplace health and queues that need attention.</p>
      </header>

      <div className="admin-tiles">
        {tiles.map((tile) => {
          const body = (
            <>
              <span className="admin-tiles__label">{tile.label}</span>
              <strong className="admin-tiles__value">{tile.value}</strong>
              {'hint' in tile && tile.hint ? (
                <span className="admin-tiles__hint">{tile.hint}</span>
              ) : null}
            </>
          )
          return tile.to ? (
            <Link key={tile.label} to={tile.to} className="admin-tiles__item admin-tiles__item--link">
              {body}
            </Link>
          ) : (
            <div key={tile.label} className="admin-tiles__item">
              {body}
            </div>
          )
        })}
      </div>
    </div>
  )
}
