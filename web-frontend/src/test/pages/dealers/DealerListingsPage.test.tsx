import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DealerProfileContext } from '../../../pages/dealers/dealer-profile-context'
import { DealerListingsPage } from '../../../pages/dealers/DealerListingsPage'
import {
  approveListing,
  approveSelectedListings,
  deactivateListing,
  deleteListing,
  getMyListings,
  unarchiveListing,
} from '../../../api/listings.api'
import type { DealerListing, ListingStatus } from '../../../api/listings.types'
import type { DealerProfile } from '../../../api/dealer.types'

vi.mock('../../../api/listings.api', async () => {
  const actual = await vi.importActual<typeof import('../../../api/listings.api')>(
    '../../../api/listings.api',
  )
  return {
    ...actual,
    getMyListings: vi.fn(),
    approveListing: vi.fn(),
    approveSelectedListings: vi.fn(),
    deactivateListing: vi.fn(),
    unarchiveListing: vi.fn(),
    deleteListing: vi.fn(),
  }
})

const getListings = vi.mocked(getMyListings)
const approve = vi.mocked(approveListing)
const approveSelected = vi.mocked(approveSelectedListings)
const deactivate = vi.mocked(deactivateListing)
const unarchive = vi.mocked(unarchiveListing)
const del = vi.mocked(deleteListing)

const listing = (overrides: Partial<DealerListing> & { status: ListingStatus }): DealerListing =>
  ({
    id: `v-${overrides.status}`,
    make: 'Toyota',
    model: 'Aqua',
    manufactureYear: 2018,
    price: 4_500_000,
    mileage: 60_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    registrationYear: 2018,
    fuelType: 'Hybrid',
    transmissionType: 'Automatic',
    vehicleType: 'CAR',
    condition: 'USED',
    description: null,
    color: 'White',
    engineCapacityCc: 1500,
    ownersCount: 1,
    locationDistrict: 'Colombo',
    locationCity: null,
    registrationNumber: null,
    chassisNumber: null,
    isNegotiable: false,
    normalization: null,
    specs: null,
    needsManualReview: false,
    reviewReason: null,
    images: [],
    ...overrides,
  }) as DealerListing

const DEALER_PROFILE: DealerProfile = {
  userId: 'dealer-1',
  dealerType: 'individual',
  companyName: 'Acme Motors',
  businessRegistrationNumber: '',
  businessAddress: '1 Main St',
  city: 'Colombo',
  contactNumber: null,
  verificationStatus: 'VERIFIED',
  rejectionReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DealerProfileContext.Provider
        value={{ data: DEALER_PROFILE, error: null, loading: false, reload: vi.fn(), setData: vi.fn() }}
      >
        <DealerListingsPage />
      </DealerProfileContext.Provider>
    </MemoryRouter>,
  )
}

describe('DealerListingsPage - row actions', () => {
  beforeEach(() => {
    getListings.mockReset()
    approve.mockReset()
    approveSelected.mockReset()
    deactivate.mockReset()
    unarchive.mockReset()
    del.mockReset()
  })

  const actionNames = () =>
    screen
      .getAllByRole('button', { name: /^(Edit|Archive|Unarchive|Delete) Toyota Aqua$/ })
      .map((button) => button.textContent)

  it('shows Edit, Archive and Delete as plain buttons, with no three-dots menu', async () => {
    getListings.mockResolvedValue([listing({ status: 'DRAFT' })])
    renderPage()

    await screen.findByRole('button', { name: 'Edit Toyota Aqua' })

    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('offers Edit and Archive, but not Unarchive or Delete, for a LIVE listing', async () => {
    getListings.mockResolvedValue([listing({ status: 'LIVE' })])
    renderPage()

    await screen.findByRole('button', { name: 'Edit Toyota Aqua' })

    expect(actionNames()).toEqual(['Edit', 'Archive'])
  })

  it('offers Edit, Unarchive and no Archive/Delete for an ARCHIVED listing', async () => {
    getListings.mockResolvedValue([listing({ status: 'ARCHIVED' })])
    renderPage()

    await screen.findByRole('button', { name: 'Edit Toyota Aqua' })

    expect(actionNames()).toEqual(['Edit', 'Unarchive'])
  })

  it('offers Edit, Archive and Delete for a DRAFT listing', async () => {
    getListings.mockResolvedValue([listing({ status: 'DRAFT' })])
    renderPage()

    await screen.findByRole('button', { name: 'Edit Toyota Aqua' })

    expect(actionNames()).toEqual(['Edit', 'Archive', 'Delete'])
  })

  it('puts Approve beside the other buttons for a listing awaiting review', async () => {
    getListings.mockResolvedValue([listing({ status: 'PENDING_REVIEW' })])
    renderPage()

    const approveButton = await screen.findByRole('button', { name: 'Approve' })
    const row = approveButton.closest('tr') as HTMLElement

    expect(within(row).getByRole('button', { name: 'Edit Toyota Aqua' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Archive Toyota Aqua' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete Toyota Aqua' })).toBeInTheDocument()
  })

  it('gives each row its own buttons, named after its vehicle', async () => {
    getListings.mockResolvedValue([
      listing({ status: 'LIVE', id: 'a', model: 'Aqua' }),
      listing({ status: 'LIVE', id: 'b', model: 'Vitz' }),
    ])
    renderPage()

    expect(await screen.findByRole('button', { name: 'Edit Toyota Aqua' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Toyota Vitz' })).toBeInTheDocument()
  })

  it('unarchives from its button and reloads the list', async () => {
    getListings.mockResolvedValue([listing({ status: 'ARCHIVED' })])
    unarchive.mockResolvedValue(listing({ status: 'LIVE' }))
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Unarchive Toyota Aqua' }))

    await waitFor(() => expect(unarchive).toHaveBeenCalledWith('v-ARCHIVED'))
    await waitFor(() => expect(getListings).toHaveBeenCalledTimes(2))
  })

  it('opens the edit form from the Edit button', async () => {
    getListings.mockResolvedValue([listing({ status: 'LIVE' })])
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit Toyota Aqua' }))

    expect(await screen.findByRole('heading', { name: /Edit Toyota Aqua/ })).toBeInTheDocument()
  })

  it('deleting asks for confirmation first, then deletes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    getListings.mockResolvedValue([listing({ status: 'DRAFT' })])
    del.mockResolvedValue(undefined)
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Delete Toyota Aqua' }))

    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => expect(del).toHaveBeenCalledWith('v-DRAFT'))
    confirmSpy.mockRestore()
  })

  it('approving updates the row in place without re-fetching the list', async () => {
    getListings.mockResolvedValue([listing({ status: 'PENDING_REVIEW' })])
    approve.mockResolvedValue(listing({ status: 'LIVE' }))
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(approve).toHaveBeenCalledWith('v-PENDING_REVIEW'))
    // The row's own status badge reflects the change immediately...
    await waitFor(() => expect(screen.getByText('LIVE')).toBeInTheDocument())
    // ...without the page falling back to a full reload() to learn it.
    expect(getListings).toHaveBeenCalledTimes(1)
  })

  it('has no Approve all button, whether or not anything is pending', async () => {
    getListings.mockResolvedValue([listing({ status: 'PENDING_REVIEW' })])
    renderPage()

    await screen.findByText('Toyota Aqua', { exact: false })

    expect(screen.queryByRole('button', { name: /Approve all/ })).not.toBeInTheDocument()
    // The review banner stays; approving is per row or from a ticked selection.
    expect(screen.getByText(/awaiting your review/)).toBeInTheDocument()
  })

  it('sorts lowest-confidence first by default and refetches when switched to most recent', async () => {
    getListings.mockResolvedValue([listing({ status: 'LIVE' })])
    renderPage()

    const user = userEvent.setup()
    const sort = await screen.findByLabelText('Sort by')
    expect(getListings).toHaveBeenLastCalledWith('confidence_asc', expect.anything())

    await user.selectOptions(sort, 'createdAt')

    await waitFor(() =>
      expect(getListings).toHaveBeenLastCalledWith(undefined, expect.anything()),
    )
  })

  it('archiving a listing asks for confirmation first', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    getListings.mockResolvedValue([listing({ status: 'LIVE' })])
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Archive Toyota Aqua' }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(deactivate).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})

describe('DealerListingsPage - selecting listings', () => {
  const three = () => [
    listing({ status: 'PENDING_REVIEW', id: 'p1', model: 'Aqua' }),
    listing({ status: 'PENDING_REVIEW', id: 'p2', model: 'Vitz' }),
    listing({ status: 'LIVE', id: 'l1', model: 'Prius' }),
  ]

  beforeEach(() => {
    getListings.mockReset()
    approveSelected.mockReset()
    getListings.mockResolvedValue(three())
  })

  it('shows no selection bar until something is ticked', async () => {
    renderPage()
    await screen.findByLabelText('Select Toyota Aqua')

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
  })

  it('ticking a row shows how many are selected and offers to approve them', async () => {
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByLabelText('Select Toyota Aqua'))

    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve selected (1)' })).toBeEnabled()
  })

  it('select all ticks every listing, and ticking it again clears them', async () => {
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByLabelText('Select all listings'))
    expect(screen.getByText(/3 selected/)).toBeInTheDocument()
    expect(screen.getByLabelText('Select Toyota Prius')).toBeChecked()

    await user.click(screen.getByLabelText('Select all listings'))
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
  })

  it('shows the select-all box as partly ticked when only some rows are', async () => {
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByLabelText('Select Toyota Aqua'))

    const all = screen.getByLabelText('Select all listings') as HTMLInputElement
    expect(all.indeterminate).toBe(true)
    expect(all.checked).toBe(false)
  })

  it('counts only the ones awaiting review towards Approve selected', async () => {
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByLabelText('Select all listings'))

    expect(screen.getByText('3 selected (2 awaiting review)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve selected (2)' })).toBeInTheDocument()
  })

  it('disables Approve selected when none of the ticked listings is awaiting review', async () => {
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByLabelText('Select Toyota Prius'))

    expect(screen.getByRole('button', { name: 'Approve selected (0)' })).toBeDisabled()
  })

  it('asks first, then approves only the selected pending listings in one request', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    approveSelected.mockResolvedValue({ approved: 2, skipped: 0 })
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByLabelText('Select all listings'))
    await user.click(screen.getByRole('button', { name: 'Approve selected (2)' }))

    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => expect(approveSelected).toHaveBeenCalledTimes(1))
    // The live listing is ticked but is not sent: only pending ones can be approved.
    expect(approveSelected.mock.calls[0][0].sort()).toEqual(['p1', 'p2'])
    confirmSpy.mockRestore()
  })

  it('clears the selection and reloads once the approval is done', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    approveSelected.mockResolvedValue({ approved: 2, skipped: 0 })
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByLabelText('Select all listings'))
    await user.click(screen.getByRole('button', { name: 'Approve selected (2)' }))

    await waitFor(() => expect(getListings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/selected/)).not.toBeInTheDocument())
    confirmSpy.mockRestore()
  })

  it('does nothing when the dealer declines the confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByLabelText('Select Toyota Aqua'))
    await user.click(screen.getByRole('button', { name: 'Approve selected (1)' }))

    expect(approveSelected).not.toHaveBeenCalled()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('Clear selection empties it without calling the server', async () => {
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByLabelText('Select Toyota Aqua'))
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
    expect(approveSelected).not.toHaveBeenCalled()
  })
})

describe('DealerListingsPage - columns and sorting', () => {
  const bodyOrder = () =>
    screen
      .getAllByRole('checkbox')
      .map((box) => box.getAttribute('aria-label'))
      .filter((label) => label?.startsWith('Select Toyota'))

  beforeEach(() => {
    getListings.mockReset()
    getListings.mockResolvedValue([
      listing({ status: 'LIVE', id: 'a', model: 'Aqua', price: 300, manufactureYear: 2015, vehicleType: 'CAR', condition: 'USED' }),
      listing({ status: 'LIVE', id: 'b', model: 'Vitz', price: 100, manufactureYear: 2022, vehicleType: 'BIKE', condition: 'NEW' }),
      listing({ status: 'LIVE', id: 'c', model: 'Prius', price: 200, manufactureYear: 2019, vehicleType: 'THREE_WHEELER', condition: 'RECONDITIONED' }),
    ])
  })

  it('has Type and Condition columns, shown as words', async () => {
    renderPage()
    await screen.findByLabelText('Select Toyota Aqua')

    expect(screen.getByRole('columnheader', { name: /Type/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Condition/ })).toBeInTheDocument()
    expect(screen.getByText('Three wheeler')).toBeInTheDocument()
    expect(screen.getByText('Reconditioned')).toBeInTheDocument()
    expect(screen.queryByText('THREE_WHEELER')).not.toBeInTheDocument()
  })

  it('sorts by price highest first on the first click, lowest first on the second', async () => {
    renderPage()
    const user = userEvent.setup()
    await screen.findByLabelText('Select Toyota Aqua')

    await user.click(screen.getByRole('button', { name: /Price/ }))
    expect(bodyOrder()).toEqual(['Select Toyota Aqua', 'Select Toyota Prius', 'Select Toyota Vitz'])
    expect(screen.getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'descending')

    await user.click(screen.getByRole('button', { name: /Price/ }))
    expect(bodyOrder()).toEqual(['Select Toyota Vitz', 'Select Toyota Prius', 'Select Toyota Aqua'])
    expect(screen.getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('a third click returns to the original order', async () => {
    renderPage()
    const user = userEvent.setup()
    await screen.findByLabelText('Select Toyota Aqua')
    const original = bodyOrder()

    const price = screen.getByRole('button', { name: /Price/ })
    await user.click(price)
    await user.click(price)
    await user.click(price)

    expect(bodyOrder()).toEqual(original)
    expect(screen.getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'none')
  })

  it('sorts by year, type and condition too', async () => {
    renderPage()
    const user = userEvent.setup()
    await screen.findByLabelText('Select Toyota Aqua')

    await user.click(screen.getByRole('button', { name: /Year/ }))
    expect(bodyOrder()[0]).toBe('Select Toyota Vitz')

    await user.click(screen.getByRole('button', { name: /Type/ }))
    expect(bodyOrder()[0]).toBe('Select Toyota Vitz') // Bike comes first A to Z

    await user.click(screen.getByRole('button', { name: /Condition/ }))
    expect(bodyOrder()[0]).toBe('Select Toyota Vitz') // New comes first A to Z
  })

  it('only one column is sorted at a time', async () => {
    renderPage()
    const user = userEvent.setup()
    await screen.findByLabelText('Select Toyota Aqua')

    await user.click(screen.getByRole('button', { name: /Price/ }))
    await user.click(screen.getByRole('button', { name: /Year/ }))

    expect(screen.getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByRole('columnheader', { name: /Year/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('choosing from the Sort by menu hands the order back to it', async () => {
    renderPage()
    const user = userEvent.setup()
    await screen.findByLabelText('Select Toyota Aqua')

    await user.click(screen.getByRole('button', { name: /Price/ }))
    await user.selectOptions(screen.getByLabelText('Sort by'), 'createdAt')

    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'none'),
    )
  })

  it('keeps the selection when the rows are re-ordered', async () => {
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByLabelText('Select Toyota Vitz'))
    await user.click(screen.getByRole('button', { name: /Price/ }))

    expect(screen.getByLabelText('Select Toyota Vitz')).toBeChecked()
    expect(screen.getByText(/^1 selected/)).toBeInTheDocument()
  })
})

describe('DealerListingsPage - table alignment', () => {
  beforeEach(() => {
    getListings.mockReset()
    getListings.mockResolvedValue([
      listing({
        status: 'LIVE',
        id: 'a',
        vehicleType: 'SUV',
        needsManualReview: true,
        specs: { seats: 5 },
      }),
    ])
  })

  it('gives every data column the same centred, equal-width treatment', async () => {
    renderPage()
    await screen.findByLabelText('Select Toyota Aqua')

    const row = screen.getByLabelText('Select Toyota Aqua').closest('tr') as HTMLElement
    for (const name of [/Type/, /Condition/, /Year/, /Price/, /Mileage/, /Status/]) {
      expect(screen.getByRole('columnheader', { name })).toHaveClass('listing-table__compact')
    }
    for (const text of ['SUV', 'Used', '2018', '4,500,000', '60,000 km']) {
      expect(within(row).getByText(text).closest('td')).toHaveClass('listing-table__compact')
    }
    expect(within(row).getByText('LIVE').closest('td')).toHaveClass('listing-table__compact')
  })

  it('leaves the vehicle column on its own, left-aligned', async () => {
    renderPage()
    await screen.findByLabelText('Select Toyota Aqua')

    expect(screen.getByRole('columnheader', { name: /Vehicle/ })).not.toHaveClass('listing-table__compact')
    expect(screen.getByRole('columnheader', { name: /Vehicle/ })).toHaveClass('listing-table__vehicle')
  })

  it('keeps SUV in capitals', async () => {
    renderPage()

    expect(await screen.findByText('SUV')).toBeInTheDocument()
    expect(screen.queryByText('Suv')).not.toBeInTheDocument()
  })

  it('starts the details row under the vehicle name, not under the checkbox', async () => {
    renderPage()
    await screen.findByLabelText('Select Toyota Aqua')

    const detailsRow = document.querySelector('.listing-table__details-row') as HTMLElement
    const cells = detailsRow.querySelectorAll('td')

    expect(cells).toHaveLength(2)
    expect(cells[0]).toBeEmptyDOMElement()
    expect(cells[1]).toHaveAttribute('colspan', '8')
  })
})
