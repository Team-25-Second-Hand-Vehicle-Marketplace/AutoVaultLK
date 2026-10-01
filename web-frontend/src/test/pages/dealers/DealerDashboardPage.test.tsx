import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DealerDashboardPage } from '../../../pages/dealers/DealerDashboardPage'
import { DealerProfileContext } from '../../../pages/dealers/dealer-profile-context'
import { getMyListings } from '../../../api/listings.api'
import type { DealerListing } from '../../../api/listings.types'
import type { DealerProfile } from '../../../api/dealer.types'

vi.mock('../../../api/listings.api', async () => {
  const actual = await vi.importActual<typeof import('../../../api/listings.api')>(
    '../../../api/listings.api',
  )
  return { ...actual, getMyListings: vi.fn() }
})

const mockGetListings = vi.mocked(getMyListings)

const DEALER_PROFILE: DealerProfile = {
  userId: 'dealer-1',
  dealerType: 'business',
  companyName: 'Vishula Riders',
  businessRegistrationNumber: 'BR-1',
  businessAddress: '1 Main St',
  city: 'Colombo',
  contactNumber: '+94701234567',
  verificationStatus: 'VERIFIED',
  rejectionReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const listing = (overrides: Partial<DealerListing>): DealerListing =>
  ({
    id: `v-${Math.random()}`,
    status: 'LIVE',
    make: 'Toyota',
    model: 'Aqua',
    manufactureYear: 2018,
    price: 4_500_000,
    mileage: 60_000,
    createdAt: '2026-08-01T00:00:00.000Z',
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

function renderPage() {
  return render(
    <MemoryRouter>
      <DealerProfileContext.Provider
        value={{ data: DEALER_PROFILE, error: null, loading: false, reload: vi.fn(), setData: vi.fn() }}
      >
        <DealerDashboardPage />
      </DealerProfileContext.Provider>
    </MemoryRouter>,
  )
}

describe('DealerDashboardPage - inventory summary', () => {
  beforeEach(() => {
    mockGetListings.mockReset()
  })

  it('sums price across LIVE listings only for the inventory-value tile', async () => {
    mockGetListings.mockResolvedValue([
      listing({ id: 'v1', status: 'LIVE', price: 1_000_000 }),
      listing({ id: 'v2', status: 'LIVE', price: 2_000_000 }),
      listing({ id: 'v3', status: 'DRAFT', price: 9_999_999 }),
    ])

    renderPage()

    expect(await screen.findByText('Live inventory value')).toBeInTheDocument()
    expect(screen.getByText('LKR 3,000,000')).toBeInTheDocument()
  })

  it('lists the 5 most recent listings, newest first', async () => {
    mockGetListings.mockResolvedValue([
      listing({ id: 'old', make: 'Nissan', model: 'Leaf', createdAt: '2026-01-01T00:00:00.000Z' }),
      listing({ id: 'new', make: 'Honda', model: 'Fit', createdAt: '2026-08-01T00:00:00.000Z' }),
    ])

    renderPage()

    const section = (await screen.findByText('Recent listings')).closest('section') as HTMLElement
    const items = within(section).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Honda Fit')
    expect(items[1]).toHaveTextContent('Nissan Leaf')
  })

  it('groups the make-composition pie by make', async () => {
    mockGetListings.mockResolvedValue([
      listing({ id: 'v1', make: 'Toyota' }),
      listing({ id: 'v2', make: 'Toyota' }),
      listing({ id: 'v3', make: 'Honda' }),
    ])

    renderPage()

    const section = (await screen.findByText('Inventory by make')).closest('section') as HTMLElement
    expect(within(section).getByText('2 · 67%')).toBeInTheDocument()
    expect(within(section).getByText('1 · 33%')).toBeInTheDocument()
  })

  it('shows an empty state instead of a list when there are no listings', async () => {
    mockGetListings.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('No listings yet.')).toBeInTheDocument()
    expect(screen.getByText('LKR 0')).toBeInTheDocument()
  })
})
