import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminDashboardPage } from '../../../pages/admin/AdminDashboardPage'
import { getDashboard, getReports, getReportsTimeSeries, searchAuditLogs } from '../../../api/admin.api'
import type {
  AdminAuditLog,
  AdminDashboard,
  AdminReports,
  AdminTimeSeries,
} from '../../../api/admin.types'

vi.mock('../../../api/admin.api', () => ({
  getDashboard: vi.fn(),
  getReports: vi.fn(),
  getReportsTimeSeries: vi.fn(),
  searchAuditLogs: vi.fn(),
}))

const mockDashboard = vi.mocked(getDashboard)
const mockReports = vi.mocked(getReports)
const mockTimeSeries = vi.mocked(getReportsTimeSeries)
const mockActivity = vi.mocked(searchAuditLogs)

const DASHBOARD: AdminDashboard = {
  listings: { live: 42 },
  users: { total: 60, dealers: 12, pendingDealers: 3 },
  uploads: { byStatus: { COMPLETED: 8, FAILED: 2, PARTIAL: 1 } },
  notifications: { total: 100, sent: 96, failed: 4, deliveryRate: 0.96 },
  audit: { recentCount: 5 },
}

const REPORTS: AdminReports = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-08-31T00:00:00.000Z',
  listings: { LIVE: 40, DRAFT: 5, REJECTED: 1 },
  uploads: { jobs: 11, totalRecords: 500, validRecords: 480, invalidRecords: 20 },
  jobRates: { errorRate: 0.05, partialRate: 0.1 },
  activeUsers: 30,
}

const TIME_SERIES: AdminTimeSeries = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-08-31T00:00:00.000Z',
  listings: [
    { date: '2026-08-29', count: 2 },
    { date: '2026-08-30', count: 0 },
    { date: '2026-08-31', count: 5 },
  ],
  users: [
    { date: '2026-08-29', count: 1 },
    { date: '2026-08-30', count: 1 },
    { date: '2026-08-31', count: 0 },
  ],
  uploads: [
    { date: '2026-08-29', count: 0 },
    { date: '2026-08-30', count: 0 },
    { date: '2026-08-31', count: 1 },
  ],
}

const ACTIVITY: AdminAuditLog[] = [
  {
    id: 'log-1',
    actorId: 'admin-1',
    action: 'DEALER_APPROVED',
    entityType: 'dealer',
    entityId: 'dealer-123456789',
    changes: {},
    ipAddress: '127.0.0.1',
    createdAt: '2026-08-15T10:00:00.000Z',
  },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>,
  )
}

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    mockDashboard.mockReset()
    mockReports.mockReset()
    mockActivity.mockReset()
    // Every test below cares about something other than the trend charts,
    // so this gives them a working default instead of repeating it six times;
    // the dedicated trend-chart test overrides it with more telling data.
    mockTimeSeries.mockReset().mockResolvedValue(TIME_SERIES)
  })

  it('shows the KPI row from the dashboard summary', async () => {
    mockDashboard.mockResolvedValue(DASHBOARD)
    mockReports.mockResolvedValue(REPORTS)
    mockActivity.mockResolvedValue(ACTIVITY)

    renderPage()

    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(screen.getByText('Live listings')).toBeInTheDocument()
    expect(screen.getByText('60')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders a bar per listing status from the report window', async () => {
    mockDashboard.mockResolvedValue(DASHBOARD)
    mockReports.mockResolvedValue(REPORTS)
    mockActivity.mockResolvedValue(ACTIVITY)

    renderPage()

    const heading = await screen.findByText('Listings by status')
    // Scoped to this card: the same statuses also appear in the Listings
    // composition pie's legend just below, so an unscoped getByText would be
    // ambiguous between the two.
    const card = heading.closest('section') as HTMLElement
    expect(within(card).getByText('LIVE')).toBeInTheDocument()
    expect(within(card).getByText('DRAFT')).toBeInTheDocument()
    expect(within(card).getByText('REJECTED')).toBeInTheDocument()
  })

  it('renders a pie legend with each status’s share of listings', async () => {
    mockDashboard.mockResolvedValue(DASHBOARD)
    mockReports.mockResolvedValue(REPORTS)
    mockActivity.mockResolvedValue(ACTIVITY)

    renderPage()

    const heading = await screen.findByText('Listings composition')
    const card = heading.closest('section') as HTMLElement
    // REPORTS.listings = { LIVE: 40, DRAFT: 5, REJECTED: 1 }, total 46.
    expect(within(card).getByText('40 · 87%')).toBeInTheDocument()
    expect(within(card).getByText('5 · 11%')).toBeInTheDocument()
    expect(within(card).getByText('1 · 2%')).toBeInTheDocument()
  })

  it('renders a bar per upload status from the dashboard summary', async () => {
    mockDashboard.mockResolvedValue(DASHBOARD)
    mockReports.mockResolvedValue(REPORTS)
    mockActivity.mockResolvedValue(ACTIVITY)

    renderPage()

    expect(await screen.findByText('Uploads by status')).toBeInTheDocument()
    expect(screen.getByText('COMPLETED')).toBeInTheDocument()
    expect(screen.getByText('FAILED')).toBeInTheDocument()
    expect(screen.getByText('PARTIAL')).toBeInTheDocument()
  })

  it('shows the notification delivery split as a pie', async () => {
    mockDashboard.mockResolvedValue(DASHBOARD)
    mockReports.mockResolvedValue(REPORTS)
    mockActivity.mockResolvedValue(ACTIVITY)

    renderPage()

    // DASHBOARD.notifications = { sent: 96, failed: 4 } -> 96% / 4%.
    expect(await screen.findByText('96 · 96%')).toBeInTheDocument()
    expect(screen.getByText('4 · 4%')).toBeInTheDocument()
    expect(screen.getByText('96 sent · 4 failed')).toBeInTheDocument()
  })

  it('shows recent activity from the audit log', async () => {
    mockDashboard.mockResolvedValue(DASHBOARD)
    mockReports.mockResolvedValue(REPORTS)
    mockActivity.mockResolvedValue(ACTIVITY)

    renderPage()

    expect(await screen.findByText('DEALER APPROVED')).toBeInTheDocument()
    expect(screen.getByText(/dealer-1/)).toBeInTheDocument()
  })

  it('renders a daily trend chart per metric with the right peak and total', async () => {
    mockDashboard.mockResolvedValue(DASHBOARD)
    mockReports.mockResolvedValue(REPORTS)
    mockActivity.mockResolvedValue(ACTIVITY)

    renderPage()

    expect(await screen.findByText('Activity over time')).toBeInTheDocument()
    expect(screen.getByText('New listings')).toBeInTheDocument()
    expect(screen.getByText('New users')).toBeInTheDocument()
    expect(screen.getByText('Uploads submitted')).toBeInTheDocument()
    // Listings series: [2, 0, 5] -> peak 5, total 7.
    expect(screen.getByText('Peak 5/day')).toBeInTheDocument()
    expect(screen.getByText('7 total')).toBeInTheDocument()
  })

  it('shows an empty state instead of a chart when a metric has no activity', async () => {
    mockDashboard.mockResolvedValue(DASHBOARD)
    mockReports.mockResolvedValue(REPORTS)
    mockActivity.mockResolvedValue(ACTIVITY)
    mockTimeSeries.mockResolvedValue({
      ...TIME_SERIES,
      uploads: [
        { date: '2026-08-29', count: 0 },
        { date: '2026-08-30', count: 0 },
      ],
    })

    renderPage()

    expect(await screen.findByText('Uploads submitted')).toBeInTheDocument()
    expect(screen.getByText('No activity in this window.')).toBeInTheDocument()
  })

  it('still shows the KPI row and uploads when the report totals fail to load', async () => {
    mockDashboard.mockResolvedValue(DASHBOARD)
    mockReports.mockRejectedValue(new Error('network down'))
    mockActivity.mockResolvedValue(ACTIVITY)

    renderPage()

    expect(await screen.findByText('Live listings')).toBeInTheDocument()
    // Both Listings by status and Listings composition read from the same
    // failed reports call, so each independently shows its own copy of the
    // error rather than one card silently going blank.
    expect(screen.getAllByText('Could not load report totals.')).toHaveLength(2)
    // Uploads-by-status comes from the dashboard summary, not the reports
    // call, so it must still render even though reports failed.
    expect(screen.getByText('Uploads by status')).toBeInTheDocument()
    expect(screen.getByText('COMPLETED')).toBeInTheDocument()
  })
})
