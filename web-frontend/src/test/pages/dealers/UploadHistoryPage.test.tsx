import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { UploadHistoryPage } from '../../../pages/dealers/UploadHistoryPage'
import { getMyUploadJobs } from '../../../api/ingestion.api'
import type { JobsPage } from '../../../api/ingestion.types'

vi.mock('../../../api/ingestion.api', async () => {
  const actual = await vi.importActual<typeof import('../../../api/ingestion.api')>(
    '../../../api/ingestion.api',
  )
  return { ...actual, getMyUploadJobs: vi.fn() }
})

const mockGetJobs = vi.mocked(getMyUploadJobs)

const page = (overrides: Partial<JobsPage> = {}): JobsPage => ({
  items: [],
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  ...overrides,
})

function renderPage() {
  return render(
    <MemoryRouter>
      <UploadHistoryPage />
    </MemoryRouter>,
  )
}

describe('UploadHistoryPage', () => {
  beforeEach(() => {
    mockGetJobs.mockReset()
  })

  it('shows an empty state with no past uploads', async () => {
    mockGetJobs.mockResolvedValue(page())

    renderPage()

    expect(await screen.findByText("You haven't submitted a bulk upload yet.")).toBeInTheDocument()
  })

  it('lists each job with its file name, status and counts', async () => {
    mockGetJobs.mockResolvedValue(
      page({
        items: [
          {
            id: 'job-1',
            status: 'PARTIAL',
            fileName: 'inventory.csv',
            totalRecords: 40,
            validRecords: 34,
            invalidRecords: 6,
            createdAt: '2026-09-01T10:00:00.000Z',
            updatedAt: '2026-09-01T10:02:00.000Z',
          },
        ],
        total: 1,
        totalPages: 1,
      }),
    )

    renderPage()

    expect(await screen.findByText('inventory.csv')).toBeInTheDocument()
    expect(screen.getByText('Completed with skipped rows')).toBeInTheDocument()
    expect(screen.getByText('34')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('links each row to its upload status page', async () => {
    mockGetJobs.mockResolvedValue(
      page({
        items: [
          {
            id: 'job-1',
            status: 'COMPLETED',
            fileName: 'inventory.csv',
            totalRecords: 10,
            validRecords: 10,
            invalidRecords: 0,
            createdAt: '2026-09-01T10:00:00.000Z',
            updatedAt: '2026-09-01T10:02:00.000Z',
          },
        ],
        total: 1,
        totalPages: 1,
      }),
    )

    renderPage()

    expect(await screen.findByRole('link', { name: 'View details' })).toHaveAttribute(
      'href',
      '/dealer/uploads/job-1',
    )
  })

  it('notes when the list is truncated to the most recent uploads', async () => {
    mockGetJobs.mockResolvedValue(
      page({
        items: [
          {
            id: 'job-1',
            status: 'COMPLETED',
            fileName: 'a.csv',
            totalRecords: 5,
            validRecords: 5,
            invalidRecords: 0,
            createdAt: '2026-09-01T10:00:00.000Z',
            updatedAt: '2026-09-01T10:02:00.000Z',
          },
        ],
        total: 45,
        totalPages: 3,
      }),
    )

    renderPage()

    expect(await screen.findByText('Showing the 1 most recent uploads of 45.')).toBeInTheDocument()
  })

  it('shows an error banner when the request fails', async () => {
    mockGetJobs.mockRejectedValue(new Error('network down'))

    renderPage()

    expect(await screen.findByText('Could not load your upload history.')).toBeInTheDocument()
  })
})
