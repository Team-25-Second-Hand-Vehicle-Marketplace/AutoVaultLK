import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { useDealerProfile } from './useDealerProfile'

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
