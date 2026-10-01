import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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

  it('shows Bulk upload to a verified business dealer', async () => {
    getProfile.mockResolvedValue({
      dealerType: 'business',
      verificationStatus: 'VERIFIED',
    } as DealerProfile)
    renderLayout()

    expect(await screen.findByRole('link', { name: 'Bulk upload' })).toHaveAttribute(
      'href',
      '/dealer/upload',
    )
    expect(screen.getByRole('link', { name: 'Upload history' })).toHaveAttribute(
      'href',
      '/dealer/uploads',
    )
    expect(screen.getByRole('link', { name: 'My listings' })).toBeInTheDocument()
  })

  it('orders a business dealer\'s nav with Business details last', async () => {
    getProfile.mockResolvedValue({
      dealerType: 'business',
      verificationStatus: 'VERIFIED',
    } as DealerProfile)
    renderLayout()

    await screen.findByRole('link', { name: 'Bulk upload' })
    const labels = within(screen.getByRole('navigation', { name: 'Dealer' }))
      .getAllByRole('link')
      .map((a) => a.textContent)
    expect(labels).toEqual([
      'Dashboard',
      'My listings',
      'Manual listing',
      'Bulk upload',
      'Upload history',
      'Business details',
    ])
  })

  it('does not show Bulk upload or Upload history to a verified individual dealer, but keeps My listings', async () => {
    getProfile.mockResolvedValue({
      dealerType: 'individual',
      verificationStatus: 'VERIFIED',
    } as DealerProfile)
    renderLayout()

    // Let the profile request settle before asserting an absence, otherwise
    // this would pass trivially while the request is still in flight.
    await waitFor(() => expect(getProfile).toHaveBeenCalled())
    await act(async () => {})

    expect(screen.queryByRole('link', { name: 'Bulk upload' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upload history' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My listings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manual listing' })).toHaveAttribute(
      'href',
      '/dealer/listings/new',
    )
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

  it('shows no nav links until the profile - and so verification status - is known', async () => {
    // A request that never settles: the layout must not show any nav item
    // while it doesn't yet know whether the dealer is verified. The Outlet
    // content (DealerDashboardPage in real use) renders regardless - it has
    // its own loading state - this is only about the sidebar.
    getProfile.mockReturnValue(new Promise(() => {}))
    renderLayout()

    await waitFor(() => expect(getProfile).toHaveBeenCalled())

    expect(screen.queryByRole('link', { name: 'Bulk upload' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My listings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
  })

  // A dealer can now log in while PENDING or REJECTED (approval no longer
  // gates login). Until VERIFIED, the resubmit/status screen at /dealer is
  // the only thing there is - so there is nothing to link to.
  it('shows no nav links to a dealer who is not yet verified', async () => {
    getProfile.mockResolvedValue({
      dealerType: 'business',
      verificationStatus: 'PENDING',
    } as DealerProfile)
    renderLayout()

    await waitFor(() => expect(getProfile).toHaveBeenCalled())
    await act(async () => {})

    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My listings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Bulk upload' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Business details' })).not.toBeInTheDocument()
  })

  it('shows no nav links to a rejected dealer either', async () => {
    getProfile.mockResolvedValue({
      dealerType: 'individual',
      verificationStatus: 'REJECTED',
    } as DealerProfile)
    renderLayout()

    await waitFor(() => expect(getProfile).toHaveBeenCalled())
    await act(async () => {})

    expect(screen.queryByRole('link', { name: 'My listings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Business details' })).not.toBeInTheDocument()
  })
})
