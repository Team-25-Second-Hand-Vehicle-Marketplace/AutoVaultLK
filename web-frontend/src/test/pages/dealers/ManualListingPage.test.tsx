import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { toast } from 'sonner'
import { ManualListingPage } from '../../../pages/dealers/ManualListingPage'
import { createListing, uploadListingImages } from '../../../api/listings.api'

vi.mock('../../../api/listings.api', async () => {
  const actual = await vi.importActual<typeof import('../../../api/listings.api')>(
    '../../../api/listings.api',
  )
  return { ...actual, createListing: vi.fn(), uploadListingImages: vi.fn() }
})

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// The real form is covered by ListingForm.test.tsx; here only the page's own
// create-then-return behaviour matters, so the form is a stand-in that submits.
vi.mock('../../../components/dealers/ListingForm', () => ({
  ListingForm: ({
    onSubmit,
    onCancel,
  }: {
    onSubmit: (input: unknown, images: File[]) => Promise<void>
    onCancel: () => void
  }) => (
    <div>
      <button onClick={() => void onSubmit({ make: 'Toyota', model: 'Aqua' }, [new File(['x'], 'a.jpg')])}>
        submit with photo
      </button>
      <button onClick={() => void onSubmit({ make: 'Toyota', model: 'Aqua' }, [])}>submit</button>
      <button onClick={onCancel}>cancel</button>
    </div>
  ),
}))

const create = vi.mocked(createListing)
const upload = vi.mocked(uploadListingImages)

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dealer/listings/new']}>
      <Routes>
        <Route path="/dealer/listings/new" element={<ManualListingPage />} />
        <Route path="/dealer/listings" element={<div>My listings page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ManualListingPage', () => {
  beforeEach(() => {
    create.mockReset()
    upload.mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it('creates the listing and returns to My listings', async () => {
    create.mockResolvedValue({ id: 'new-1' } as never)

    renderPage()
    expect(screen.getByRole('heading', { name: 'Manual listing' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => expect(screen.getByText('My listings page')).toBeInTheDocument())
    expect(upload).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Listing created and sent for review')
  })

  it('uploads the photos after creating, then returns to My listings', async () => {
    create.mockResolvedValue({ id: 'new-1' } as never)
    upload.mockResolvedValue(undefined as never)

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'submit with photo' }))

    await waitFor(() => expect(screen.getByText('My listings page')).toBeInTheDocument())
    expect(upload).toHaveBeenCalledWith('new-1', expect.any(Array))
  })

  it('still returns to My listings, with a photo-specific error, when only the photo upload fails', async () => {
    create.mockResolvedValue({ id: 'new-1' } as never)
    upload.mockRejectedValue(new Error('boom'))

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'submit with photo' }))

    await waitFor(() => expect(screen.getByText('My listings page')).toBeInTheDocument())
    expect(toast.error).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('stays on the form when the listing itself fails to create', async () => {
    create.mockRejectedValue(new Error('rejected'))

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.queryByText('My listings page')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Manual listing' })).toBeInTheDocument()
  })

  it('goes back to My listings on cancel', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(await screen.findByText('My listings page')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })
})
