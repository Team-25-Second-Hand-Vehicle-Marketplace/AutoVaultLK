import { AdminDashboardView } from './AdminDashboardPage'
import type {
  AdminAuditLog,
  AdminDashboard,
  AdminReports,
  AdminTimeSeries,
} from '../../api/admin.types'

/**
 * Renders the real dashboard against fixed mock data - no login, no backend
 * required. For checking a local dashboard change in the browser before
 * pushing it; not linked from anywhere in the app.
 *
 * Only mounted in dev (see the `import.meta.env.DEV` guard around its route
 * in App.tsx) - `npm run build` never includes this route or this file's
 * code in what ships.
 */

const MOCK_DASHBOARD: AdminDashboard = {
  listings: { live: 128 },
  users: { total: 214, dealers: 37, pendingDealers: 4 },
  uploads: { byStatus: { COMPLETED: 22, PARTIAL: 3, FAILED: 2, PROCESSING: 1, PENDING: 1 } },
  notifications: { total: 640, sent: 611, failed: 29, deliveryRate: 611 / 640 },
  audit: { recentCount: 18 },
}

const MOCK_REPORTS: AdminReports = {
  from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  to: new Date().toISOString(),
  listings: { LIVE: 128, PENDING_REVIEW: 9, DRAFT: 6, SOLD: 14, ARCHIVED: 11, REJECTED: 3 },
  uploads: { jobs: 29, totalRecords: 1840, validRecords: 1720, invalidRecords: 120 },
  jobRates: { errorRate: 0.07, partialRate: 0.1 },
  activeUsers: 96,
}

const MOCK_ACTIVITY: AdminAuditLog[] = [
  {
    id: 'log-1',
    actorId: 'admin-1',
    action: 'DEALER_APPROVED',
    entityType: 'dealer',
    entityId: 'a1b2c3d4-e5f6-7890-aaaa-bbbbccccdddd',
    changes: {},
    ipAddress: '203.0.113.4',
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  },
  {
    id: 'log-2',
    actorId: 'admin-1',
    action: 'DEALER_REJECTED',
    entityType: 'dealer',
    entityId: 'b2c3d4e5-f678-90aa-bbbb-ccccddddeeee',
    changes: { reason: 'Certificate expired' },
    ipAddress: '203.0.113.4',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'log-3',
    actorId: 'admin-2',
    action: 'USER_DEACTIVATED',
    entityType: 'user',
    entityId: 'c3d4e5f6-7890-aabb-ccdd-eeeeffff0000',
    changes: {},
    ipAddress: '198.51.100.7',
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'log-4',
    actorId: null,
    action: 'UPLOAD_JOB_FAILED',
    entityType: 'upload_job',
    entityId: 'd4e5f678-90aa-bbcc-ddee-fffff0000011',
    changes: {},
    ipAddress: null,
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  },
]

/**
 * A deterministic-but-varied 30-day series - a flat mock line would hide
 * whether the chart actually reads shape and trend correctly.
 */
function buildMockSeries(base: number, amplitude: number, days = 30): { date: string; count: number }[] {
  const jitter = [0, 2, -1, 3, 0, -2, 1, 4, -1, 0, 2, -3, 1, 0, 5, -2, 1, 0, -1, 3, 2, -2, 0, 1, 4, -1, 0, 2, -1, 3]
  return Array.from({ length: days }, (_, i) => {
    const daysAgo = days - 1 - i
    const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const wave = Math.sin(i / 4) * amplitude
    const count = Math.max(0, Math.round(base + wave + (jitter[i % jitter.length] ?? 0)))
    return { date, count }
  })
}

const MOCK_TIME_SERIES: AdminTimeSeries = {
  from: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString(),
  to: new Date().toISOString(),
  listings: buildMockSeries(6, 3),
  users: buildMockSeries(4, 2),
  uploads: buildMockSeries(1, 1),
}

export function AdminDashboardPreviewPage() {
  return (
    <div>
      <div
        style={{
          background: '#111827',
          color: '#fff',
          padding: '8px 16px',
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        Preview only - fixed mock data, dev build only, not part of the app's real navigation.
      </div>
      <AdminDashboardView
        data={MOCK_DASHBOARD}
        reports={{ loading: false, error: null, data: MOCK_REPORTS }}
        activity={{ loading: false, error: null, data: MOCK_ACTIVITY }}
        timeSeries={{ loading: false, error: null, data: MOCK_TIME_SERIES }}
      />
    </div>
  )
}
