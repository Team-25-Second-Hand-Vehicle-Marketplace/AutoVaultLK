import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BulkUploadPage } from '../../../pages/dealers/BulkUploadPage'
import { getActiveJob } from '../../../api/ingestion.api'
import { getSearchOptions } from '../../../api/search.api'

vi.mock('../../../api/ingestion.api', async () => {
  const actual = await vi.importActual<typeof import('../../../api/ingestion.api')>(
    '../../../api/ingestion.api',
  )
  return { ...actual, getActiveJob: vi.fn() }
})

vi.mock('../../../api/search.api', () => ({ getSearchOptions: vi.fn() }))

const activeJob = vi.mocked(getActiveJob)
const searchOptions = vi.mocked(getSearchOptions)

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

describe('BulkUploadPage - resuming an in-progress upload', () => {
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

describe('BulkUploadPage - instructions and column list', () => {
  const DISMISSED_KEY = 'autovault.bulkUploadGuideDismissed'

  beforeEach(() => {
    localStorage.clear()
    activeJob.mockReset()
    activeJob.mockResolvedValue(null)
  })

  const openPage = async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Bulk upload' })
  }

  it('opens the instructions on a first visit', async () => {
    await openPage()

    const guide = screen.getByRole('dialog', { name: 'How to prepare your upload' })
    expect(within(guide).getByText(/Inventory file \(CSV\/JSON, required\)/)).toBeInTheDocument()
    expect(within(guide).getByText(/Photos \(ZIP, optional\)/)).toBeInTheDocument()
  })

  it('can be closed, and reopened from the Instructions button', async () => {
    await openPage()

    await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Instructions' }))
    expect(screen.getByRole('dialog', { name: 'How to prepare your upload' })).toBeInTheDocument()
  })

  it('shows again on the next visit when closed without opting out', async () => {
    await openPage()
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull()
  })

  it("stays closed on later visits once the dealer ticks Don't show this again", async () => {
    await openPage()
    await userEvent.click(screen.getByLabelText("Don't show this again"))
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('1')

    document.body.innerHTML = ''
    await openPage()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Still reachable on demand.
    await userEvent.click(screen.getByRole('button', { name: 'Instructions' }))
    expect(screen.getByRole('dialog', { name: 'How to prepare your upload' })).toBeInTheDocument()
  })

  it('no longer lists every column on the page itself', async () => {
    localStorage.setItem(DISMISSED_KEY, '1')
    await openPage()

    expect(screen.queryByRole('heading', { name: 'Columns' })).not.toBeInTheDocument()
    expect(screen.queryByText('abs_equipped')).not.toBeInTheDocument()
  })

  it('View fields shows the required columns first and keeps optional ones hidden', async () => {
    localStorage.setItem(DISMISSED_KEY, '1')
    await openPage()

    await userEvent.click(screen.getByRole('button', { name: 'View fields' }))

    const dialog = screen.getByRole('dialog', { name: 'CSV/JSON fields' })
    expect(within(dialog).getByText('Required columns')).toBeInTheDocument()
    expect(within(dialog).getByText('make')).toBeInTheDocument()
    expect(within(dialog).getByText('condition')).toBeInTheDocument()
    expect(within(dialog).queryByText('abs_equipped')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('heading', { name: 'Optional columns' })).not.toBeInTheDocument()
  })

  it('reveals the optional columns only when asked, and can hide them again', async () => {
    localStorage.setItem(DISMISSED_KEY, '1')
    await openPage()
    await userEvent.click(screen.getByRole('button', { name: 'View fields' }))
    const dialog = screen.getByRole('dialog', { name: 'CSV/JSON fields' })

    await userEvent.click(within(dialog).getByRole('button', { name: /Optional columns/ }))
    expect(within(dialog).getByText('abs_equipped')).toBeInTheDocument()
    expect(within(dialog).getByText('vehicle_type')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Hide optional columns' }))
    expect(within(dialog).queryByText('abs_equipped')).not.toBeInTheDocument()
  })

  it('goes from the instructions to the column list', async () => {
    await openPage()

    const guide = screen.getByRole('dialog', { name: 'How to prepare your upload' })
    await userEvent.click(within(guide).getByRole('button', { name: 'View fields' }))

    expect(screen.queryByRole('dialog', { name: 'How to prepare your upload' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'CSV/JSON fields' })).toBeInTheDocument()
  })

  it('keeps Download template next to View fields', async () => {
    localStorage.setItem(DISMISSED_KEY, '1')
    await openPage()

    expect(screen.getByRole('button', { name: 'View fields' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download template' })).toBeInTheDocument()
  })
})

describe('BulkUploadPage - known makes and models', () => {
  beforeEach(() => {
    localStorage.setItem('autovault.bulkUploadGuideDismissed', '1')
    activeJob.mockReset()
    activeJob.mockResolvedValue(null)
    searchOptions.mockReset()
    searchOptions.mockResolvedValue({
      vehicleTypes: ['CAR', 'BIKE'],
      conditions: ['NEW', 'USED'],
      fuelTypes: ['PETROL'],
      transmissionTypes: ['MANUAL'],
      bodyTypes: ['SEDAN'],
      districts: ['Colombo'],
      makes: [{ id: 'm1', name: 'Toyota', models: [{ id: 'x1', name: 'Aqua' }, { id: 'x2', name: 'Vitz' }] }],
    } as never)
  })

  it('is a button next to View fields, not a section at the bottom of the page', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Bulk upload' })

    expect(screen.getByRole('button', { name: 'Known makes & models' })).toBeInTheDocument()
    expect(screen.queryByText(/known makes, models & values/i)).not.toBeInTheDocument()
    // Nothing is fetched until it is opened.
    expect(searchOptions).not.toHaveBeenCalled()
  })

  it('opens a dialog listing the recognised makes, models and values', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Bulk upload' })

    await userEvent.click(screen.getByRole('button', { name: 'Known makes & models' }))

    const dialog = screen.getByRole('dialog', { name: 'Known makes, models and values' })
    expect(await within(dialog).findByText('Toyota')).toBeInTheDocument()
    expect(within(dialog).getByText('Aqua, Vitz')).toBeInTheDocument()
    expect(within(dialog).getByText('CAR, BIKE')).toBeInTheDocument()
    expect(within(dialog).queryByText(/_/)).not.toBeInTheDocument()
  })

  it('closes with Done', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Bulk upload' })
    await userEvent.click(screen.getByRole('button', { name: 'Known makes & models' }))

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
