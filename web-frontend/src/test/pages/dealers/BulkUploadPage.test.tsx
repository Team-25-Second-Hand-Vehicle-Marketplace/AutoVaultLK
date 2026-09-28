import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BulkUploadPage } from '../../../pages/dealers/BulkUploadPage'
import { getActiveJob } from '../../../api/ingestion.api'

vi.mock('../../../api/ingestion.api', async () => {
  const actual = await vi.importActual<typeof import('../../../api/ingestion.api')>(
    '../../../api/ingestion.api',
  )
  return { ...actual, getActiveJob: vi.fn() }
})

const activeJob = vi.mocked(getActiveJob)

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dealer/upload']}>
      <Routes>
        <Route path="/dealer/upload" element={<BulkUploadPage />} />
        <Route path="/dealer/uploads/:jobId" element={<div>Upload status page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('BulkUploadPage — resuming an in-progress upload', () => {
  it('redirects straight to the active job instead of showing the form', async () => {
    activeJob.mockResolvedValue({ id: 'job-1' })

    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('Checking for an upload already in progress')

    await waitFor(() => expect(screen.getByText('Upload status page')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Bulk upload' })).not.toBeInTheDocument()
  })

  it('shows the upload form when there is no active job', async () => {
    activeJob.mockResolvedValue(null)

    renderPage()

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Bulk upload' })).toBeInTheDocument(),
    )
  })

  it('shows the upload form if the active-job check itself fails', async () => {
    activeJob.mockRejectedValue(new Error('network down'))

    renderPage()

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Bulk upload' })).toBeInTheDocument(),
    )
  })
})
