import { useCallback } from 'react'
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { getMyDealerProfile } from '../../api/dealer.api'
import type { DealerProfile } from '../../api/dealer.types'
import { toErrorMessage } from '../../api/client'
import { useAuth } from '../../auth/useAuth'
import { useAsyncData } from '../../hooks/useAsyncData'
import { DealerProfileContext } from './dealer-profile-context'
import { BrandMark } from '../../components/layout/BrandMark'
import { Button } from '../../components/ui/Button'
import { PageTransition } from '../../components/layout/PageTransition'

const DASHBOARD_NAV = { to: '/dealer', end: true, label: 'Dashboard' } as const
// end: true so this tab is not also active on /dealer/listings/new.
const LISTINGS_NAV = { to: '/dealer/listings', end: true, label: 'My listings' } as const
const MANUAL_LISTING_NAV = {
  to: '/dealer/listings/new',
  end: false,
  label: 'Manual listing',
} as const
const PROFILE_NAV = { to: '/dealer/profile', end: false, label: 'Business details' } as const

// Bulk upload (and its history) is for business dealers only (the API
// rejects individuals), so both are added below only once the profile says so.
const BULK_UPLOAD_NAV = { to: '/dealer/upload', end: false, label: 'Bulk upload' } as const
const UPLOAD_HISTORY_NAV = { to: '/dealer/uploads', end: false, label: 'Upload history' } as const

// Business details sits last for both dealer types.
const INDIVIDUAL_NAV = [DASHBOARD_NAV, LISTINGS_NAV, MANUAL_LISTING_NAV, PROFILE_NAV] as const
const BUSINESS_NAV = [
  DASHBOARD_NAV,
  LISTINGS_NAV,
  MANUAL_LISTING_NAV,
  BULK_UPLOAD_NAV,
  UPLOAD_HISTORY_NAV,
  PROFILE_NAV,
] as const

const profileError = (err: unknown) => toErrorMessage(err, 'Could not load your dealer profile.')

export function DealerLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const outlet = useOutlet()

  const fetchProfile = useCallback((signal: AbortSignal) => getMyDealerProfile(signal), [])
  const profile = useAsyncData<DealerProfile>(fetchProfile, profileError)

  // Hidden while loading and if the profile fails to load: fail closed. A
  // dealer who is not yet VERIFIED (can now log in while PENDING/REJECTED -
  // see auth-user-service's DealerProfilesService) sees no nav at all: the
  // index route is the only thing there is for them, and DealerDashboardPage
  // renders their status/resubmit screen there instead of the dashboard.
  const verified = profile.data?.verificationStatus === 'VERIFIED'
  const navItems = !verified
    ? []
    : profile.data?.dealerType === 'business'
      ? BUSINESS_NAV
      : INDIVIDUAL_NAV

  const onSignOut = async () => {
    await logout()
    navigate('/dealer/login', { replace: true })
  }

  return (
    <div className="dealer-shell">
      <aside className="dealer-shell__sidebar">
        <div className="dealer-shell__brand">
          <BrandMark to="/dealer" />
          <span className="dealer-shell__badge">Dealer</span>
        </div>

        <nav className="dealer-shell__nav" aria-label="Dealer">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `dealer-shell__link${isActive ? ' dealer-shell__link--active' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="dealer-shell__footer">
          <p className="dealer-shell__user">{user?.email}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => void onSignOut()}>
            Sign out
          </Button>
        </div>
      </aside>

      <div className="dealer-shell__main">
        <DealerProfileContext.Provider value={profile}>
          <PageTransition id={pathname}>{outlet}</PageTransition>
        </DealerProfileContext.Provider>
      </div>
    </div>
  )
}
