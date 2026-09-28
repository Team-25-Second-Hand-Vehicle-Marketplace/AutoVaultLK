import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Car, ClipboardList, ShieldCheck, Users } from 'lucide-react'
import { getDashboard, getReports, searchAuditLogs } from '../../api/admin.api'
import type { AdminAuditLog, AdminDashboard, AdminReports } from '../../api/admin.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { Pill } from '../../components/ui/Pill'
import { BarRow } from '../../components/admin/BarRow'
import { Meter } from '../../components/admin/Meter'
import { formatDate } from '../../utils/format'

/** A status's reserved app color, by CSS custom property name — the same
 * tokens the Pill component already uses, so a "failed" bar and a "failed"
 * pill never disagree with each other. */
const LISTING_STATUS_COLOR: Record<string, string> = {
  LIVE: '--success',
  PENDING_REVIEW: '--accent',
  DRAFT: '--text-muted',
  SOLD: '--accent',
  ARCHIVED: '--text-muted',
  REJECTED: '--danger',
}

const UPLOAD_STATUS_COLOR: Record<string, string> = {
  COMPLETED: '--success',
  PARTIAL: '--warning-text',
  FAILED: '--danger',
  PROCESSING: '--accent',
  PENDING: '--text-muted',
}

const dashboardError = (err: unknown) => toErrorMessage(err, 'Could not load dashboard.')
const reportsError = (err: unknown) => toErrorMessage(err, 'Could not load report totals.')
const activityError = (err: unknown) => toErrorMessage(err, 'Could not load recent activity.')

/** The window the "by the numbers" sections summarise — matches the default AdminReportsPage opens with. */
const REPORT_WINDOW_DAYS = 30

interface AsyncSlice<T> {
  loading: boolean
  error: string | null
  data: T | null
}

/**
 * The dashboard's markup, taking its three data sources as plain props
 * rather than fetching them itself — AdminDashboardPage below is the only
 * real caller, wiring these to useAsyncData, but keeping this half
 * fetch-free is what lets AdminDashboardPreviewPage render the exact same
 * page from fixed mock data, with no login and no backend, for a quick
 * local look before anything is pushed.
 */
export function AdminDashboardView({
  data,
  reports,
  activity,
}: {
  data: AdminDashboard
  reports: AsyncSlice<AdminReports>
  activity: AsyncSlice<AdminAuditLog[]>
}) {
  const kpis = [
    { icon: Car, label: 'Live listings', value: data.listings.live, to: undefined },
    { icon: Users, label: 'Total users', value: data.users.total, to: '/admin/users' },
    { icon: ShieldCheck, label: 'Dealers', value: data.users.dealers, to: undefined },
    {
      icon: ClipboardList,
      label: 'Pending approvals',
      value: data.users.pendingDealers,
      to: '/admin/users?tab=pending',
    },
  ]

  const listingEntries = Object.entries(reports.data?.listings ?? {})
  const listingMax = Math.max(1, ...listingEntries.map(([, v]) => v))

  const uploadEntries = Object.entries(data.uploads.byStatus)
  const uploadMax = Math.max(1, ...uploadEntries.map(([, v]) => v))

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <h1>Dashboard</h1>
        <p>Marketplace health and queues that need attention.</p>
      </header>

      <div className="admin-kpis">
        {kpis.map(({ icon: Icon, label, value, to }) => {
          const body = (
            <>
              <span className="admin-kpi__icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <strong className="admin-kpi__value">{value.toLocaleString('en-LK')}</strong>
              <span className="admin-kpi__label">{label}</span>
            </>
          )
          return to ? (
            <Link key={label} to={to} className="admin-kpi admin-kpi--link">
              {body}
            </Link>
          ) : (
            <div key={label} className="admin-kpi">
              {body}
            </div>
          )
        })}
      </div>

      <div className="admin-grid">
        <section className="admin-card">
          <header className="admin-card__head">
            <h2>Listings by status</h2>
            <span className="admin-muted">Last {REPORT_WINDOW_DAYS} days</span>
          </header>
          {reports.loading ? (
            <p className="admin-muted" role="status">
              Loading…
            </p>
          ) : reports.error ? (
            <ErrorBanner message={reports.error} />
          ) : listingEntries.length === 0 ? (
            <p className="admin-muted">No listings in this window.</p>
          ) : (
            <div className="bar-list">
              {listingEntries.map(([status, count]) => (
                <BarRow
                  key={status}
                  label={status.replace(/_/g, ' ')}
                  value={count}
                  max={listingMax}
                  colorVar={LISTING_STATUS_COLOR[status] ?? '--accent'}
                />
              ))}
            </div>
          )}
        </section>

        <section className="admin-card">
          <header className="admin-card__head">
            <h2>Uploads by status</h2>
            <Link to="/admin/uploads" className="admin-card__link">
              View all
            </Link>
          </header>
          {uploadEntries.length === 0 ? (
            <p className="admin-muted">No uploads yet.</p>
          ) : (
            <div className="bar-list">
              {uploadEntries.map(([status, count]) => (
                <BarRow
                  key={status}
                  label={status.replace(/_/g, ' ')}
                  value={count}
                  max={uploadMax}
                  colorVar={UPLOAD_STATUS_COLOR[status] ?? '--accent'}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="admin-grid">
        <section className="admin-card">
          <header className="admin-card__head">
            <h2>Notification delivery</h2>
          </header>
          <Meter
            ratio={data.notifications.deliveryRate}
            label="Delivered"
            hint={`${data.notifications.sent.toLocaleString('en-LK')} sent · ${data.notifications.failed.toLocaleString('en-LK')} failed`}
          />
          {reports.data && (
            <div className="admin-card__submeters">
              <Meter
                ratio={1 - reports.data.jobRates.errorRate}
                label="Upload success rate"
                hint={`Last ${REPORT_WINDOW_DAYS} days`}
              />
              <Meter
                ratio={1 - reports.data.jobRates.partialRate}
                label="Upload rows fully accepted"
                hint={`Last ${REPORT_WINDOW_DAYS} days`}
              />
            </div>
          )}
        </section>

        <section className="admin-card">
          <header className="admin-card__head">
            <h2>Recent activity</h2>
            <Link to="/admin/audit-logs" className="admin-card__link">
              View all
            </Link>
          </header>
          {activity.loading ? (
            <p className="admin-muted" role="status">
              Loading…
            </p>
          ) : activity.error ? (
            <ErrorBanner message={activity.error} />
          ) : !activity.data || activity.data.length === 0 ? (
            <p className="admin-muted">No recent activity.</p>
          ) : (
            <ul className="activity-feed">
              {activity.data.slice(0, 6).map((log) => (
                <li key={log.id} className="activity-feed__item">
                  <Pill>{log.action}</Pill>
                  <span className="activity-feed__entity">
                    {log.entityType}
                    {log.entityId ? ` · ${log.entityId.slice(0, 8)}…` : ''}
                  </span>
                  <span className="activity-feed__when">{formatDate(log.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

export function AdminDashboardPage() {
  const fetchDashboard = useCallback((signal: AbortSignal) => getDashboard(signal), [])
  const dashboard = useAsyncData<AdminDashboard>(fetchDashboard, dashboardError)

  const fetchReports = useCallback((signal: AbortSignal) => {
    const to = new Date()
    const from = new Date(to.getTime() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    return getReports(from.toISOString(), to.toISOString(), signal)
  }, [])
  const reports = useAsyncData<AdminReports>(fetchReports, reportsError)

  // The audit page's own endpoint already returns most-recent-first, capped
  // at 200 server-side — this just takes the first handful for a preview.
  const fetchActivity = useCallback((signal: AbortSignal) => searchAuditLogs({}, signal), [])
  const activity = useAsyncData<AdminAuditLog[]>(fetchActivity, activityError)

  if (dashboard.loading) {
    return (
      <div className="admin-page">
        <p className="admin-muted" role="status">
          Loading dashboard…
        </p>
      </div>
    )
  }

  if (dashboard.error || !dashboard.data) {
    return (
      <div className="admin-page">
        <ErrorBanner message={dashboard.error ?? 'No data'} />
      </div>
    )
  }

  return <AdminDashboardView data={dashboard.data} reports={reports} activity={activity} />
}
