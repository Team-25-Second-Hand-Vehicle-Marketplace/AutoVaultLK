import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminReportsPage } from '../../../pages/admin/AdminReportsPage'
import { getReports } from '../../../api/admin.api'
import type { AdminReports } from '../../../api/admin.types'

vi.mock('../../../api/admin.api', () => ({
  getReports: vi.fn(),
}))

const mockGetReports = vi.mocked(getReports)

const REPORT: AdminReports = {
  from: '2026-08-29T00:00:00.000Z',
  to: '2026-09-28T00:00:00.000Z',
  listings: { LIVE: 40, DRAFT: 5 },
  uploads: { jobs: 10, totalRecords: 500, validRecords: 480, invalidRecords: 20 },
  jobRates: { errorRate: 0.1, partialRate: 0.2 },
  activeUsers: 30,
}

describe('AdminReportsPage', () => {
  beforeEach(() => {
    mockGetReports.mockReset()
  })

  it('auto-loads a report on mount, without needing "Run report" clicked first', async () => {
    mockGetReports.mockResolvedValue(REPORT)

    render(<AdminReportsPage />)

    expect(await screen.findByText('AutoVault LK - Marketplace Report')).toBeInTheDocument()
    expect(mockGetReports).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Choose a range and run a report.')).not.toBeInTheDocument()
  })

  it('shows the KPI summary and the report period as a document header', async () => {
    mockGetReports.mockResolvedValue(REPORT)

    render(<AdminReportsPage />)

    await screen.findByText('AutoVault LK - Marketplace Report')
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('Active users created')).toBeInTheDocument()
    expect(screen.getByText('10.0%')).toBeInTheDocument()
    expect(screen.getByText('20.0%')).toBeInTheDocument()
  })

  it('re-runs with the new range when the form is submitted', async () => {
    mockGetReports.mockResolvedValue(REPORT)
    const user = userEvent.setup()

    render(<AdminReportsPage />)
    await screen.findByText('AutoVault LK - Marketplace Report')
    mockGetReports.mockClear()

    // Deliberately a fixed, far-past date rather than something computed
    // relative to "today": the page defaults From to today-minus-30-days, so
    // a nearby hardcoded date can silently collide with that default on the
    // day this test happens to run (react's setState no-ops when the typed
    // value matches what's already there, so no new fetch ever fires) -
    // 2020-01-01 can never land inside that rolling 30-day window for the
    // realistic lifetime of this suite.
    const fromInput = screen.getByLabelText('From') as HTMLInputElement
    await user.clear(fromInput)
    await user.type(fromInput, '2020-01-01')
    await user.click(screen.getByRole('button', { name: 'Run report' }))

    await waitFor(() => expect(mockGetReports).toHaveBeenCalledTimes(1))
    // Compare against the same local-time-to-ISO conversion the page itself
    // does, not a literal 'starts with 2020-01-01' - that assumes UTC, and a
    // local midnight can land on the previous UTC day west of Greenwich (this
    // machine runs UTC+5:30, but the page's own conversion should match
    // wherever it runs).
    const [fromArg] = mockGetReports.mock.calls[0]
    expect(fromArg).toBe(new Date('2020-01-01T00:00:00').toISOString())
  })

  it('only offers Download PDF once a report has loaded', async () => {
    mockGetReports.mockResolvedValue(REPORT)

    render(<AdminReportsPage />)

    expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument()
    await screen.findByText('AutoVault LK - Marketplace Report')
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument()
  })
})
