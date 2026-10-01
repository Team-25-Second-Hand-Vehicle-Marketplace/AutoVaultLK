import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListingForm } from '../../../components/dealers/ListingForm'
import type { DealerListing } from '../../../api/listings.types'

/**
 * FR-58: the manual listing form never had an image field before this.
 * What these guard is the client-side validation that mirrors
 * marketplace-service's ImageUploadService limits (so a rejection is
 * instant, not a round trip to the server) and that no files selected is
 * treated as "unchanged" on edit, not as "clear the photos" - the backend
 * replaces the whole image set on any upload, so calling it with zero
 * files, or calling it accidentally, would delete a listing's photos.
 */

const jpeg = (name: string, sizeBytes = 1024) => {
  const file = new File([new Uint8Array(sizeBytes)], name, { type: 'image/jpeg' })
  return file
}

/** The CSV-parity columns a DealerListing now carries. */
const COLUMN_DEFAULTS = {
  color: 'White',
  engineCapacityCc: 1500,
  ownersCount: 1,
  locationDistrict: 'Colombo',
  locationCity: null,
  registrationNumber: null,
  chassisNumber: null,
  isNegotiable: false,
}

const validFields = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.selectOptions(screen.getByLabelText('Vehicle type'), 'CAR')
  await user.type(screen.getByLabelText('Make'), 'Toyota')
  await user.type(screen.getByLabelText('Model'), 'Vitz')
  await user.type(screen.getByLabelText('Manufacture year'), '2015')
  await user.type(screen.getByLabelText('Price (LKR)'), '3500000')
  await user.type(screen.getByLabelText('Mileage (km)'), '45000')
  await user.selectOptions(screen.getByLabelText('Fuel type'), 'PETROL')
  await user.selectOptions(screen.getByLabelText('Transmission'), 'AUTOMATIC')
  await user.type(screen.getByLabelText('Color'), 'White')
  await user.type(screen.getByLabelText('Engine capacity (cc)'), '1500')
  await user.type(screen.getByLabelText('Previous owners'), '1')
  await user.type(screen.getByLabelText('District'), 'Colombo')
}

describe('ListingForm CSV-parity fields', () => {
  it('requires the same columns the CSV requires before submitting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<ListingForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create listing" />)

    await user.click(screen.getByRole('button', { name: 'Create listing' }))

    expect(await screen.findByText('Color is required')).toBeInTheDocument()
    expect(screen.getByText('District is required')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Vehicle type/)).toHaveAttribute('aria-invalid', 'true')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('sends the extra columns and a specs object', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ListingForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create listing" />)

    await validFields(user)
    await user.type(screen.getByLabelText('City (optional)'), 'Nugegoda')
    await user.selectOptions(screen.getByLabelText('Body type (optional)'), 'HATCHBACK')
    await user.type(screen.getByLabelText('Seats (optional)'), '5')
    await user.click(screen.getByLabelText('Sunroof'))
    await user.click(screen.getByLabelText('Price is negotiable'))
    await user.click(screen.getByRole('button', { name: 'Create listing' }))

    const [input] = onSubmit.mock.calls[0] as [Record<string, unknown>]
    expect(input).toMatchObject({
      color: 'White',
      engineCapacityCc: 1500,
      ownersCount: 1,
      locationDistrict: 'Colombo',
      locationCity: 'Nugegoda',
      isNegotiable: true,
      specs: { body_type: 'HATCHBACK', seats: 5, sunroof: true },
    })
  })

  it('swaps the category fields with the vehicle type', async () => {
    const user = userEvent.setup()
    render(<ListingForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create listing" />)

    // Nothing is assumed: no category fields until a type is chosen.
    expect(screen.queryByLabelText('Seats (optional)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Stroke type (optional)')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Vehicle type'), 'CAR')
    expect(screen.getByLabelText('Seats (optional)')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Vehicle type'), 'BIKE')
    expect(screen.getByLabelText('Stroke type (optional)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Seats (optional)')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Vehicle type'), 'LORRY')
    expect(screen.getByLabelText('Axle count (optional)')).toBeInTheDocument()
  })
})

describe('ListingForm vehicle type', () => {
  it('is required, and not defaulted to Car', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<ListingForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create listing" />)

    expect(screen.getByLabelText('Vehicle type')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Create listing' }))

    await waitFor(() =>
      expect(screen.getByLabelText(/^Vehicle type/)).toHaveAttribute('aria-invalid', 'true'),
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('locks the dependent fields until a type is chosen, then unlocks them', async () => {
    const user = userEvent.setup()
    render(<ListingForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create listing" />)

    expect(screen.getByLabelText('Body type (optional)')).toBeDisabled()
    expect(screen.getByLabelText('Sunroof')).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Choose a vehicle type')

    await user.selectOptions(screen.getByLabelText('Vehicle type'), 'CAR')

    expect(screen.getByLabelText('Body type (optional)')).toBeEnabled()
    expect(screen.getByLabelText('Sunroof')).toBeEnabled()
    expect(screen.queryByText(/to unlock the details/)).not.toBeInTheDocument()
  })

  it('locks cabin comfort equipment on a bike but leaves alloy wheels', async () => {
    const user = userEvent.setup()
    render(<ListingForm onSubmit={vi.fn()} onCancel={vi.fn()} submitLabel="Create listing" />)

    await user.selectOptions(screen.getByLabelText('Vehicle type'), 'BIKE')

    expect(screen.getByLabelText('Sunroof')).toBeDisabled()
    expect(screen.getByLabelText('Leather seats')).toBeDisabled()
    expect(screen.getByLabelText('Air conditioning')).toBeDisabled()
    expect(screen.getByLabelText('Alloy wheels')).toBeEnabled()

    await user.selectOptions(screen.getByLabelText('Vehicle type'), 'CAR')
    expect(screen.getByLabelText('Sunroof')).toBeEnabled()
  })

  it('drops a ticked comfort item when the type changes to a bike', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ListingForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create listing" />)

    await validFields(user)
    await user.click(screen.getByLabelText('Sunroof'))
    await user.selectOptions(screen.getByLabelText('Vehicle type'), 'BIKE')
    await user.click(screen.getByRole('button', { name: 'Create listing' }))

    const [input] = onSubmit.mock.calls[0] as [{ vehicleType: string; specs: Record<string, unknown> }]
    expect(input.vehicleType).toBe('BIKE')
    expect(input.specs).not.toHaveProperty('sunroof')
  })

  it('clears a category value when its fields are hidden, so it cannot block the submit unseen', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ListingForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create listing" />)

    await validFields(user)
    await user.type(screen.getByLabelText('Seats (optional)'), '99')
    await user.selectOptions(screen.getByLabelText('Vehicle type'), 'BIKE')
    await user.click(screen.getByRole('button', { name: 'Create listing' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

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
    // applyAccept: false at setup - the <input accept="image/jpeg,..."> would
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
          ...COLUMN_DEFAULTS,
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

  const LISTING_WITH_IMAGES: DealerListing = {
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
    ...COLUMN_DEFAULTS,
    normalization: null,
    specs: null,
    needsManualReview: false,
    reviewReason: null,
    images: [
      { id: 'img-1', isPrimary: true, displayOrder: 0, url: null, thumbnailUrl: 'a.jpg' },
      { id: 'img-2', isPrimary: false, displayOrder: 1, url: null, thumbnailUrl: 'b.jpg' },
    ],
  }

  it('shows a Remove control for each existing photo when editing', () => {
    render(
      <ListingForm
        listing={LISTING_WITH_IMAGES}
        onSubmit={vi.fn()}
        onDeleteImage={vi.fn()}
        onCancel={vi.fn()}
        submitLabel="Save changes"
      />,
    )

    expect(screen.getByText('Current photos')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Remove this photo' })).toHaveLength(2)
  })

  it('calls onDeleteImage with the image id and removes its thumbnail on success', async () => {
    const onDeleteImage = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <ListingForm
        listing={LISTING_WITH_IMAGES}
        onSubmit={vi.fn()}
        onDeleteImage={onDeleteImage}
        onCancel={vi.fn()}
        submitLabel="Save changes"
      />,
    )

    const [firstRemove] = screen.getAllByRole('button', { name: 'Remove this photo' })
    await user.click(firstRemove)

    expect(onDeleteImage).toHaveBeenCalledWith('img-1')
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Remove this photo' })).toHaveLength(1),
    )
  })

  it('keeps the thumbnail when onDeleteImage rejects', async () => {
    const onDeleteImage = vi.fn().mockRejectedValue(new Error('network error'))
    const user = userEvent.setup()
    render(
      <ListingForm
        listing={LISTING_WITH_IMAGES}
        onSubmit={vi.fn()}
        onDeleteImage={onDeleteImage}
        onCancel={vi.fn()}
        submitLabel="Save changes"
      />,
    )

    const [firstRemove] = screen.getAllByRole('button', { name: 'Remove this photo' })
    await user.click(firstRemove)

    await waitFor(() => expect(onDeleteImage).toHaveBeenCalled())
    expect(screen.getAllByRole('button', { name: 'Remove this photo' })).toHaveLength(2)
  })

  it('does not show the current-photos section when the listing has no images', () => {
    render(
      <ListingForm
        listing={{ ...LISTING_WITH_IMAGES, images: [] }}
        onSubmit={vi.fn()}
        onDeleteImage={vi.fn()}
        onCancel={vi.fn()}
        submitLabel="Save changes"
      />,
    )

    expect(screen.queryByText('Current photos')).not.toBeInTheDocument()
  })
})
