import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DealerProfileContext } from '../../../pages/dealers/dealer-profile-context'
import { DealerListingsPage } from '../../../pages/dealers/DealerListingsPage'
import {
  approveListing,
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
    deactivateListing: vi.fn(),
    unarchiveListing: vi.fn(),
    deleteListing: vi.fn(),
  }
})

const getListings = vi.mocked(getMyListings)
const approve = vi.mocked(approveListing)
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
    <DealerProfileContext.Provider
      value={{ data: DEALER_PROFILE, error: null, loading: false, reload: vi.fn() }}
    >
      <DealerListingsPage />
    </DealerProfileContext.Provider>,
  )
}

describe('DealerListingsPage — row actions menu', () => {
  beforeEach(() => {
    getListings.mockReset()
    approve.mockReset()
    deactivate.mockReset()
    unarchive.mockReset()
    del.mockReset()
  })

  it('offers Edit and Archive, but not Unarchive or Delete, for a LIVE listing', async () => {
    getListings.mockResolvedValue([listing({ status: 'LIVE' })])
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /more actions/i }))

    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Unarchive' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('offers Edit, Unarchive and no Archive/Delete for an ARCHIVED listing', async () => {
    getListings.mockResolvedValue([listing({ status: 'ARCHIVED' })])
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /more actions/i }))

    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Unarchive' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('offers Edit, Archive and Delete for a DRAFT listing', async () => {
    getListings.mockResolvedValue([listing({ status: 'DRAFT' })])
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /more actions/i }))

    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('unarchives from the menu and reloads the list', async () => {
    getListings.mockResolvedValue([listing({ status: 'ARCHIVED' })])
    unarchive.mockResolvedValue(listing({ status: 'LIVE' }))
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /more actions/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Unarchive' }))

    await waitFor(() => expect(unarchive).toHaveBeenCalledWith('v-ARCHIVED'))
    await waitFor(() => expect(getListings).toHaveBeenCalledTimes(2))
  })

  it('archiving a listing asks for confirmation first', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    getListings.mockResolvedValue([listing({ status: 'LIVE' })])
    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /more actions/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(deactivate).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
