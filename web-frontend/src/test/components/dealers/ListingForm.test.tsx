import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListingForm } from '../../../components/dealers/ListingForm'

/**
 * FR-58: the manual listing form never had an image field before this.
 * What these guard is the client-side validation that mirrors
 * marketplace-service's ImageUploadService limits (so a rejection is
 * instant, not a round trip to the server) and that no files selected is
 * treated as "unchanged" on edit, not as "clear the photos" — the backend
 * replaces the whole image set on any upload, so calling it with zero
 * files, or calling it accidentally, would delete a listing's photos.
 */

const jpeg = (name: string, sizeBytes = 1024) => {
  const file = new File([new Uint8Array(sizeBytes)], name, { type: 'image/jpeg' })
  return file
}

const validFields = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Make'), 'Toyota')
  await user.type(screen.getByLabelText('Model'), 'Vitz')
  await user.type(screen.getByLabelText('Manufacture year'), '2015')
  await user.type(screen.getByLabelText('Price (LKR)'), '3500000')
  await user.type(screen.getByLabelText('Mileage (km)'), '45000')
  await user.selectOptions(screen.getByLabelText('Fuel type'), 'PETROL')
  await user.selectOptions(screen.getByLabelText('Transmission'), 'AUTOMATIC')
}

describe('ListingForm image field', () => {
  it('submits with an empty images array when nothing is selected', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ListingForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create listing" />)

    await validFields(user)
    await user.click(screen.getByRole('button', { name: 'Create listing' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), [])
  })

  it('submits the selected files in order', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ListingForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create listing" />)

    await validFields(user)
    const input = screen.getByLabelText(/Photos/) as HTMLInputElement
    await user.upload(input, [jpeg('a.jpg'), jpeg('b.jpg')])
    await user.click(screen.getByRole('button', { name: 'Create listing' }))

    const [, images] = onSubmit.mock.calls[0] as [unknown, File[]]
    expect(images.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg'])
  })

  it('rejects a file over the size limit before submit', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<ListingForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create listing" />)

    const input = screen.getByLabelText(/Photos/) as HTMLInputElement
    await user.upload(input, [jpeg('huge.jpg', 9 * 1024 * 1024)])

    expect(screen.getByText(/huge\.jpg is larger than/)).toBeInTheDocument()
  })

  it('rejects an unsupported file type before submit', async () => {
    // applyAccept: false at setup — the <input accept="image/jpeg,..."> would
    // otherwise have the browser itself refuse to attach a .gif before this
    // component's own validation ever runs. Real browsers enforce `accept`
    // too, but it is trivially bypassable (a file picker's "all files"
    // option, drag-and-drop, a request built by hand), so the component-
    // level check this test targets is what actually gates a dealer sending
    // marketplace-service a type it will 400 on regardless.
    const user = userEvent.setup({ applyAccept: false })
    render(<ListingForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create listing" />)

    const gif = new File(['x'], 'anim.gif', { type: 'image/gif' })
    const input = screen.getByLabelText(/Photos/) as HTMLInputElement
    await user.upload(input, [gif])

    expect(screen.getByText(/anim\.gif is not a JPEG, PNG or WebP file/)).toBeInTheDocument()
  })

  it('rejects more than the file-count limit', async () => {
    const user = userEvent.setup()
    render(<ListingForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create listing" />)

    const files = Array.from({ length: 11 }, (_, i) => jpeg(`${i}.jpg`))
    const input = screen.getByLabelText(/Photos/) as HTMLInputElement
    await user.upload(input, files)

    expect(screen.getByText(/Choose at most 10 photos/)).toBeInTheDocument()
  })

  it('clears a previous error once a valid selection is made', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<ListingForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create listing" />)

    const input = screen.getByLabelText(/Photos/) as HTMLInputElement
    await user.upload(input, [new File(['x'], 'bad.gif', { type: 'image/gif' })])
    expect(screen.getByText(/not a JPEG, PNG or WebP file/)).toBeInTheDocument()

    await user.upload(input, [jpeg('good.jpg')])
    expect(screen.queryByText(/not a JPEG, PNG or WebP file/)).not.toBeInTheDocument()
  })

  it('labels the field "Replace photos" when editing an existing listing', () => {
    render(
      <ListingForm
        listing={{
          id: 'v-1',
          status: 'LIVE',
          make: 'Toyota',
          model: 'Vitz',
          manufactureYear: 2015,
          price: 3_500_000,
          mileage: 45_000,
          createdAt: '2026-01-01T00:00:00Z',
          registrationYear: null,
          fuelType: 'PETROL',
          transmissionType: 'AUTOMATIC',
          vehicleType: 'CAR',
          condition: 'USED',
          description: null,
          normalization: null,
          specs: null,
          needsManualReview: false,
          reviewReason: null,
          images: [],
        }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitLabel="Save changes"
      />,
    )

    expect(screen.getByText('Replace photos (optional)')).toBeInTheDocument()
    expect(screen.getByText(/Leave empty to keep them/)).toBeInTheDocument()
  })
})
