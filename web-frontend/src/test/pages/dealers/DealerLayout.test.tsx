import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DealerLayout } from '../../../pages/dealers/DealerLayout'
import { getMyDealerProfile } from '../../../api/dealer.api'
import type { DealerProfile } from '../../../api/dealer.types'

vi.mock('../../../api/dealer.api', () => ({ getMyDealerProfile: vi.fn() }))
vi.mock('../../../auth/useAuth', () => ({
  useAuth: () => ({ user: { email: 'dealer@example.com' }, logout: vi.fn() }),
}))

const getProfile = vi.mocked(getMyDealerProfile)

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/dealer']}>
      <Routes>
        <Route path="/dealer" element={<DealerLayout />}>
          <Route index element={<div>Dashboard content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('DealerLayout navigation', () => {
  // Braces matter: an arrow that returns the mock makes vitest run it as a
  // teardown callback after every test.
  beforeEach(() => {
    getProfile.mockReset()
  })

  it('shows Bulk upload to a business dealer', async () => {
    getProfile.mockResolvedValue({ dealerType: 'business' } as DealerProfile)
    renderLayout()

    expect(await screen.findByRole('link', { name: 'Bulk upload' })).toHaveAttribute(
      'href',
      '/dealer/upload',
    )
    expect(screen.getByRole('link', { name: 'My listings' })).toBeInTheDocument()
  })

  it('does not show Bulk upload to an individual dealer, but keeps My listings', async () => {
    getProfile.mockResolvedValue({ dealerType: 'individual' } as DealerProfile)
    renderLayout()

    // Let the profile request settle before asserting an absence, otherwise
    // this would pass trivially while the request is still in flight.
    await waitFor(() => expect(getProfile).toHaveBeenCalled())
    await act(async () => {})

    expect(screen.queryByRole('link', { name: 'Bulk upload' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My listings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('hides Bulk upload if the profile fails to load (fail closed)', async () => {
    getProfile.mockRejectedValue(new Error('network down'))
    renderLayout()

    await waitFor(() => expect(getProfile).toHaveBeenCalled())
    await act(async () => {})

    expect(screen.queryByRole('link', { name: 'Bulk upload' })).not.toBeInTheDocument()
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
  })

  it('does not show Bulk upload until the profile says the dealer is a business', async () => {
    // A request that never settles: the layout must not show it while the
    // dealer's type is still unknown.
    getProfile.mockReturnValue(new Promise(() => {}))
    renderLayout()

    await waitFor(() => expect(getProfile).toHaveBeenCalled())

    expect(screen.queryByRole('link', { name: 'Bulk upload' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My listings' })).toBeInTheDocument()
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
  })
})
