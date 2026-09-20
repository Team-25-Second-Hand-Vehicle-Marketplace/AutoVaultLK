import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { RecommendationsSection } from '../../components/search/RecommendationsSection'
import { getRecommendations } from '../../api/recommendations.api'
import type { RecommendedVehicle } from '../../api/recommendations.types'

vi.mock('../../api/recommendations.api', () => ({ getRecommendations: vi.fn() }))

// SaveButton, rendered inside each card, reaches for auth and the saved list.
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: false, user: null }),
}))
vi.mock('../../hooks/useSavedVehicles', () => ({
  useSavedVehicles: () => ({ savedIds: [], isSaved: () => false, toggle: vi.fn() }),
}))

const vehicle = (id: string): RecommendedVehicle =>
  ({
    id,
    vehicleType: 'CAR',
    make: 'Toyota',
    model: 'Vitz',
    condition: 'USED',
    manufactureYear: 2015,
    registrationYear: 2016,
    price: 3_500_000,
    isNegotiable: true,
    mileage: 45_000,
    fuelType: 'PETROL',
    transmissionType: 'AUTOMATIC',
    locationCity: 'Nugegoda',
    locationDistrict: 'Colombo',
    specs: { body_type: 'HATCHBACK' },
    similarityScore: 0.87,
  }) as RecommendedVehicle

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
)

describe('RecommendationsSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the similar vehicles it is given', async () => {
    vi.mocked(getRecommendations).mockResolvedValue({
      vehicleId: 'v-1',
      recommendations: [vehicle('v-2'), vehicle('v-3')],
    })

    render(<RecommendationsSection vehicleId="v-1" />, { wrapper })

    await waitFor(() => expect(screen.getByText('Similar vehicles')).toBeInTheDocument())
    expect(screen.getAllByText(/Toyota Vitz/)).toHaveLength(2)
  })

  it('renders nothing when there is nothing similar', async () => {
    // A rare vehicle having no near neighbours is not something a buyer needs
    // told — an empty box would be noise on someone else's page.
    vi.mocked(getRecommendations).mockResolvedValue({
      vehicleId: 'v-1',
      recommendations: [],
    })

    const { container } = render(<RecommendationsSection vehicleId="v-1" />, { wrapper })

    await waitFor(() => expect(getRecommendations).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('.recommendations')).toBeNull())
  })

  it('renders nothing when the request fails', async () => {
    // Recommendations are an addition to the listing, not the listing. An
    // outage must not put an error box on the page the buyer asked for.
    vi.mocked(getRecommendations).mockRejectedValue(new Error('service down'))

    const { container } = render(<RecommendationsSection vehicleId="v-1" />, { wrapper })

    await waitFor(() => expect(getRecommendations).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('.recommendations')).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not clamp the limit client-side', async () => {
    // The server clamps to [1, 20] with a default of 6. A second bound here
    // would only drift from it.
    vi.mocked(getRecommendations).mockResolvedValue({
      vehicleId: 'v-1',
      recommendations: [],
    })

    render(<RecommendationsSection vehicleId="v-1" />, { wrapper })

    await waitFor(() => expect(getRecommendations).toHaveBeenCalled())
    expect(vi.mocked(getRecommendations).mock.calls[0][1]).toBeUndefined()
  })

  it('refetches when the vehicle changes', async () => {
    vi.mocked(getRecommendations).mockResolvedValue({
      vehicleId: 'v-1',
      recommendations: [],
    })

    const { rerender } = render(<RecommendationsSection vehicleId="v-1" />, { wrapper })
    await waitFor(() => expect(getRecommendations).toHaveBeenCalledTimes(1))

    // rerender re-uses the original wrapper, so this must not add another
    // MemoryRouter — nesting two Routers throws.
    rerender(<RecommendationsSection vehicleId="v-9" />)

    await waitFor(() => expect(getRecommendations).toHaveBeenCalledTimes(2))
    expect(vi.mocked(getRecommendations).mock.calls[1][0]).toBe('v-9')
  })
})
