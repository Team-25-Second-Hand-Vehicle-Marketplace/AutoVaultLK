import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminUploadsPage } from '../../../pages/admin/AdminUploadsPage'
import { getUploadRejections, listUploads } from '../../../api/admin.api'
import type { AdminUploadJob } from '../../../api/admin.types'
import type { RejectionsPage } from '../../../api/ingestion.types'

vi.mock('../../../api/admin.api', async () => {
  const actual = await vi.importActual<typeof import('../../../api/admin.api')>(
    '../../../api/admin.api',
  )
  return { ...actual, listUploads: vi.fn(), getUploadRejections: vi.fn() }
})

const mockListUploads = vi.mocked(listUploads)
const mockGetRejections = vi.mocked(getUploadRejections)

const CLEAN_JOB: AdminUploadJob = {
  id: 'job-clean',
  fileName: 'clean.csv',
  status: 'COMPLETED',
  dealerId: 'dealer-1',
  totalRecords: 5,
  validRecords: 5,
  invalidRecords: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
}

const PARTIAL_JOB: AdminUploadJob = {
  id: 'job-partial',
  fileName: 'partial.csv',
  status: 'PARTIAL',
  dealerId: 'dealer-1',
  totalRecords: 7,
  validRecords: 4,
  invalidRecords: 3,
  createdAt: '2026-08-02T00:00:00.000Z',
}

const REJECTIONS: RejectionsPage = {
  items: [
    {
      rowNumber: 2,
      stage: 'VALIDATE_ROWS',
      reason: 'Unrecognised make "Toyoat"',
      rawData: { make: 'Toyoat' },
      rawDataTruncated: false,
      createdAt: '2026-08-02T00:01:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 50,
  totalPages: 1,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminUploadsPage />
    </MemoryRouter>,
  )
}

describe('AdminUploadsPage — row-level rejection reasons', () => {
  beforeEach(() => {
    mockListUploads.mockReset()
    mockGetRejections.mockReset()
  })

  it('only offers "View reasons" for a job with invalid rows', async () => {
    mockListUploads.mockResolvedValue([CLEAN_JOB, PARTIAL_JOB])

    renderPage()

    await screen.findByText('clean.csv')
    expect(screen.getByText('partial.csv')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'View reasons' })).toHaveLength(1)
  })

  it('expands to show the rejection reasons on click, and collapses on a second click', async () => {
    mockListUploads.mockResolvedValue([PARTIAL_JOB])
    mockGetRejections.mockResolvedValue(REJECTIONS)

    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'View reasons' }))

    expect(mockGetRejections).toHaveBeenCalledWith('job-partial', 1, expect.anything())
    expect(await screen.findByText('Unrecognised make "Toyoat"')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hide reasons' }))
    expect(screen.queryByText('Unrecognised make "Toyoat"')).not.toBeInTheDocument()
  })

  it('shows an error instead of the rejections table when the lookup fails', async () => {
    mockListUploads.mockResolvedValue([PARTIAL_JOB])
    mockGetRejections.mockRejectedValue(new Error('network down'))

    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'View reasons' }))

    await waitFor(() =>
      expect(screen.getByText('Could not load the skipped rows.')).toBeInTheDocument(),
    )
  })
})
