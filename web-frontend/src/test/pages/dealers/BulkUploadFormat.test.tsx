import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BulkUploadPage } from '../../../pages/dealers/BulkUploadPage'
import { getActiveJob, uploadInventory } from '../../../api/ingestion.api'

vi.mock('../../../api/ingestion.api', async () => {
  const actual = await vi.importActual<typeof import('../../../api/ingestion.api')>(
    '../../../api/ingestion.api',
  )
  return { ...actual, getActiveJob: vi.fn(), uploadInventory: vi.fn() }
})

vi.mock('../../../api/search.api', () => ({ getSearchOptions: vi.fn() }))

const activeJob = vi.mocked(getActiveJob)
const upload = vi.mocked(uploadInventory)

const DISMISSED_KEY = 'autovault.bulkUploadGuideDismissed'

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

const fileInput = () => document.getElementById('file-input') as HTMLInputElement

// `accept` normally makes userEvent drop a file of the wrong type before the
// page ever sees it. The page's own mismatch message is what is under test, so
// the picker's filtering is switched off to let that file through.
const pick = (file: File) => userEvent.setup({ applyAccept: false }).upload(fileInput(), file)

const csvFile = () => new File(['make,model\nToyota,Aqua\n'], 'stock.csv', { type: 'text/csv' })
const jsonFile = () =>
  new File(['[{"make":"Toyota"}]'], 'stock.json', { type: 'application/json' })

describe('BulkUploadPage - choosing CSV or JSON', () => {
  beforeEach(() => {
    localStorage.setItem(DISMISSED_KEY, '1')
    activeJob.mockReset()
    activeJob.mockResolvedValue(null)
    upload.mockReset()
  })

  const openPage = async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Bulk upload' })
  }

  it('defaults to CSV, with a picker that accepts only CSV', async () => {
    await openPage()

    expect(screen.getByRole('radio', { name: 'CSV' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'JSON' })).not.toBeChecked()
    expect(fileInput().accept).toBe('.csv,text/csv')
    expect(screen.getByText('Choose a CSV file (required)')).toBeInTheDocument()
  })

  it('switches the picker, the prompt and the instructions to JSON', async () => {
    await openPage()

    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }))

    expect(fileInput().accept).toBe('.json,application/json')
    expect(screen.getByText('Choose a JSON file (required)')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Instructions' }))
    const guide = screen.getByRole('dialog', { name: 'How to prepare your upload' })
    expect(within(guide).getByText(/Inventory file \(JSON, required\)/)).toBeInTheDocument()
    expect(within(guide).getByText(/one flat object per vehicle/i)).toBeInTheDocument()
    expect(within(guide).queryByText(/header row naming each column/i)).not.toBeInTheDocument()
  })

  it('keeps the CSV instructions while CSV is selected', async () => {
    await openPage()

    await userEvent.click(screen.getByRole('button', { name: 'Instructions' }))

    const guide = screen.getByRole('dialog', { name: 'How to prepare your upload' })
    expect(within(guide).getByText(/Inventory file \(CSV, required\)/)).toBeInTheDocument()
    expect(within(guide).getByText(/header row naming each column/i)).toBeInTheDocument()
  })

  it('shows the JSON wording in the fields dialog', async () => {
    await openPage()
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }))

    await userEvent.click(screen.getByRole('button', { name: 'View fields' }))

    const dialog = screen.getByRole('dialog', { name: 'JSON fields' })
    expect(within(dialog).getByText(/one flat object/i)).toBeInTheDocument()
    // Same required set as CSV: a JSON key is a CSV header.
    expect(within(dialog).getByText('make')).toBeInTheDocument()
    expect(within(dialog).getByText('condition')).toBeInTheDocument()
  })

  it('refuses a .csv file while JSON is selected, naming the fix', async () => {
    await openPage()
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }))

    await pick(csvFile())

    expect(screen.getByRole('alert')).toHaveTextContent(
      /You selected JSON, but "stock\.csv" is a CSV file\. Choose a \.json file, or switch the format to CSV/,
    )
    expect(screen.getByRole('button', { name: 'Upload inventory' })).toBeDisabled()
  })

  it('refuses a .json file while CSV is selected', async () => {
    await openPage()

    await pick(jsonFile())

    expect(screen.getByRole('alert')).toHaveTextContent(
      /You selected CSV, but "stock\.json" is a JSON file/,
    )
  })

  it('refuses a file that is neither format', async () => {
    await openPage()

    await pick(new File(['x'], 'stock.xlsx'))

    expect(screen.getByRole('alert')).toHaveTextContent(/"stock\.xlsx" is not a CSV/)
  })

  it('drops a chosen file when the format changes, so a stale one cannot be submitted', async () => {
    await openPage()
    await pick(csvFile())
    expect(screen.getByText(/stock\.csv/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload inventory' })).toBeEnabled()

    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }))

    expect(screen.queryByText(/stock\.csv/)).not.toBeInTheDocument()
    expect(screen.getByText('Choose a JSON file (required)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload inventory' })).toBeDisabled()
  })

  it('uploads a JSON file declared as json', async () => {
    upload.mockResolvedValue({
      jobId: 'job-9',
      status: 'PENDING',
      fileName: 'stock.json',
      format: 'json',
    } as never)
    await openPage()
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }))
    const file = jsonFile()
    await pick(file)

    await userEvent.click(screen.getByRole('button', { name: 'Upload inventory' }))

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    expect(upload).toHaveBeenCalledWith('json', file, null, expect.any(Function))
    await waitFor(() => expect(screen.getByText('Upload status page')).toBeInTheDocument())
  })

  it('uploads a CSV file declared as csv', async () => {
    upload.mockResolvedValue({
      jobId: 'job-9',
      status: 'PENDING',
      fileName: 'stock.csv',
      format: 'csv',
    } as never)
    await openPage()
    const file = csvFile()
    await pick(file)

    await userEvent.click(screen.getByRole('button', { name: 'Upload inventory' }))

    await waitFor(() =>
      expect(upload).toHaveBeenCalledWith('csv', file, null, expect.any(Function)),
    )
  })

  describe('template download', () => {
    let blobs: Blob[]
    let downloads: string[]

    beforeEach(() => {
      blobs = []
      downloads = []
      URL.createObjectURL = vi.fn((blob: Blob) => {
        blobs.push(blob)
        return 'blob:template'
      })
      URL.revokeObjectURL = vi.fn()
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        downloads.push(this.download)
      })
    })

    it('downloads the CSV template by default', async () => {
      await openPage()

      await userEvent.click(screen.getByRole('button', { name: 'Download template' }))

      expect(downloads).toEqual(['autovault-inventory-template.csv'])
      expect(blobs[0].type).toMatch(/text\/csv/)
    })

    it('downloads the JSON template once JSON is selected', async () => {
      await openPage()
      await userEvent.click(screen.getByRole('radio', { name: 'JSON' }))

      await userEvent.click(screen.getByRole('button', { name: 'Download template' }))

      expect(downloads).toEqual(['autovault-inventory-template.json'])
      expect(blobs[0].type).toMatch(/application\/json/)
      const parsed = JSON.parse(await blobs[0].text()) as Record<string, unknown>[]
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed[0]).toMatchObject({ make: 'Toyota', model: 'Vitz', year: 2015 })
    })
  })
})
