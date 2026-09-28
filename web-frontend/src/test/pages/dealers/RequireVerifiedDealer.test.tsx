import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { DealerProfileContext } from '../../../pages/dealers/dealer-profile-context'
import { RequireVerifiedDealer } from '../../../pages/dealers/RequireVerifiedDealer'
import type { DealerProfile, DealerVerificationStatus } from '../../../api/dealer.types'

type ProfileState = {
  data: DealerProfile | null
  error: string | null
  loading: boolean
  reload: () => void
  setData: (updater: (data: DealerProfile | null) => DealerProfile | null) => void
}

const profile = (verificationStatus: DealerVerificationStatus): DealerProfile =>
  ({ verificationStatus, companyName: 'Test Motors' }) as DealerProfile

function renderGuard(state: Partial<ProfileState>, children: ReactNode = <div>Listings page</div>) {
  const value: ProfileState = {
    data: null,
    error: null,
    loading: false,
    reload: () => {},
    setData: () => {},
    ...state,
  }

  return render(
    <MemoryRouter initialEntries={['/dealer/listings']}>
      <DealerProfileContext.Provider value={value}>
        <Routes>
          <Route
            path="/dealer/listings"
            element={<RequireVerifiedDealer>{children}</RequireVerifiedDealer>}
          />
          <Route path="/dealer" element={<div>Verification gate</div>} />
        </Routes>
      </DealerProfileContext.Provider>
    </MemoryRouter>,
  )
}

describe('RequireVerifiedDealer (My listings / Bulk upload need VERIFIED)', () => {
  it('shows the page to a verified dealer', () => {
    renderGuard({ data: profile('VERIFIED') })

    expect(screen.getByText('Listings page')).toBeInTheDocument()
  })

  it('redirects a pending dealer to the verification gate', () => {
    renderGuard({ data: profile('PENDING') })

    expect(screen.getByText('Verification gate')).toBeInTheDocument()
    expect(screen.queryByText('Listings page')).not.toBeInTheDocument()
  })

  it('redirects a rejected dealer to the verification gate', () => {
    renderGuard({ data: profile('REJECTED') })

    expect(screen.getByText('Verification gate')).toBeInTheDocument()
    expect(screen.queryByText('Listings page')).not.toBeInTheDocument()
  })

  it('renders nothing of the page while the profile is loading', () => {
    renderGuard({ loading: true })

    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.queryByText('Listings page')).not.toBeInTheDocument()
  })

  it('fails closed when the profile cannot be loaded', () => {
    renderGuard({ error: 'Could not load your dealer profile.' })

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your dealer profile.')
    expect(screen.queryByText('Listings page')).not.toBeInTheDocument()
  })
})
