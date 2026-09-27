import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { useDealerProfile } from './useDealerProfile'

/**
 * Keeps My listings / Bulk upload / an upload's status page unreachable until
 * the dealer is VERIFIED — a dealer can now log in while PENDING or REJECTED
 * (see auth-user-service's DealerProfilesService: approval no longer gates
 * login), so this, not login, is what stands between that and the rest of
 * the dealer area. `/dealer` (the index route) always renders something
 * appropriate to the dealer's status — DealerDashboardPage branches on it —
 * so redirecting there is always safe.
 *
 * Same shape as RequireDealerType; the API enforces the same restriction
 * (assertManualUploadAllowed, isVerifiedBusinessDealer), so this is about not
 * showing a screen that would only 403 on submit.
 */
export function RequireVerifiedDealer({ children }: { children: ReactNode }) {
  const profile = useDealerProfile()

  if (profile.loading) {
    return (
      <div className="route-loading" role="status" aria-live="polite">
        Loading…
      </div>
    )
  }

  if (profile.error || !profile.data) {
    return (
      <div className="dealer-page">
        <ErrorBanner message={profile.error ?? 'Could not load your dealer profile.'} />
      </div>
    )
  }

  if (profile.data.verificationStatus !== 'VERIFIED') {
    return <Navigate to="/dealer" replace />
  }

  return <>{children}</>
}
