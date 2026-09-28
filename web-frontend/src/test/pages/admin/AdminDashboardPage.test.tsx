import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminDashboardPage } from '../../../pages/admin/AdminDashboardPage'
import { getDashboard, getReports, searchAuditLogs } from '../../../api/admin.api'
import type { AdminAuditLog, AdminDashboard, AdminReports } from '../../../api/admin.types'

vi.mock('../../../api/admin.api', () => ({
  getDashboard: vi.fn(),
  getReports: vi.fn(),
  searchAuditLogs: vi.fn(),
}))

const mockDashboard = vi.mocked(getDashboard)
const mockReports = vi.mocked(getReports)
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

    expect(await screen.findByText('Listings by status')).toBeInTheDocument()
    expect(screen.getByText('LIVE'.replace(/_/g, ' '))).toBeInTheDocument()
    expect(screen.getByText('DRAFT')).toBeInTheDocument()
    expect(screen.getByText('REJECTED')).toBeInTheDocument()
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

  it('shows the notification delivery rate as a meter percentage', async () => {
    mockDashboard.mockResolvedValue(DASHBOARD)
    mockReports.mockResolvedValue(REPORTS)
    mockActivity.mockResolvedValue(ACTIVITY)

    renderPage()

    expect(await screen.findByText('96.0%')).toBeInTheDocument()
    expect(screen.getByText('96 sent · 4 failed')).toBeInTheDocument()
  })

  it('shows recent activity from the audit log', async () => {
    mockDashboard.mockResolvedValue(DASHBOARD)
    mockReports.mockResolvedValue(REPORTS)
    mockActivity.mockResolvedValue(ACTIVITY)

    renderPage()

    expect(await screen.findByText('DEALER_APPROVED')).toBeInTheDocument()
    expect(screen.getByText(/dealer-1/)).toBeInTheDocument()
  })

  it('still shows the KPI row and uploads when the report totals fail to load', async () => {
    mockDashboard.mockResolvedValue(DASHBOARD)
    mockReports.mockRejectedValue(new Error('network down'))
    mockActivity.mockResolvedValue(ACTIVITY)

    renderPage()

    expect(await screen.findByText('Live listings')).toBeInTheDocument()
    expect(screen.getByText('Could not load report totals.')).toBeInTheDocument()
    // Uploads-by-status comes from the dashboard summary, not the reports
    // call, so it must still render even though reports failed.
    expect(screen.getByText('Uploads by status')).toBeInTheDocument()
    expect(screen.getByText('COMPLETED')).toBeInTheDocument()
  })
})
