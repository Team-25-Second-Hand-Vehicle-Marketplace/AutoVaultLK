import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { DealerProfileContext } from '../../../pages/dealers/dealer-profile-context'
import { RequireDealerType } from '../../../pages/dealers/RequireDealerType'
import type { DealerProfile } from '../../../api/dealer.types'

type ProfileState = {
  data: DealerProfile | null
  error: string | null
  loading: boolean
  reload: () => void
}

const profile = (dealerType: 'individual' | 'business'): DealerProfile =>
  ({ dealerType, companyName: 'Test Motors' }) as DealerProfile

function renderGuard(state: Partial<ProfileState>, children: ReactNode = <div>Bulk upload page</div>) {
  const value: ProfileState = { data: null, error: null, loading: false, reload: () => {}, ...state }

  return render(
    <MemoryRouter initialEntries={['/dealer/upload']}>
      <DealerProfileContext.Provider value={value}>
        <Routes>
          <Route
            path="/dealer/upload"
            element={
              <RequireDealerType type="business" fallbackTo="/dealer/listings">
                {children}
              </RequireDealerType>
            }
          />
          <Route path="/dealer/listings" element={<div>Listings page</div>} />
        </Routes>
      </DealerProfileContext.Provider>
    </MemoryRouter>,
  )
}

describe('RequireDealerType (bulk upload is business-only)', () => {
  it('shows the page to a business dealer', () => {
    renderGuard({ data: profile('business') })

    expect(screen.getByText('Bulk upload page')).toBeInTheDocument()
  })

  it('redirects an individual dealer to their listings', () => {
    renderGuard({ data: profile('individual') })

    expect(screen.getByText('Listings page')).toBeInTheDocument()
    expect(screen.queryByText('Bulk upload page')).not.toBeInTheDocument()
  })

  it('renders nothing of the page while the profile is loading', () => {
    renderGuard({ loading: true })

    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.queryByText('Bulk upload page')).not.toBeInTheDocument()
    expect(screen.queryByText('Listings page')).not.toBeInTheDocument()
  })

  it('fails closed when the profile cannot be loaded', () => {
    renderGuard({ error: 'Could not load your dealer profile.' })

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your dealer profile.')
    expect(screen.queryByText('Bulk upload page')).not.toBeInTheDocument()
  })
})
