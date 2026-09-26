import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { DealerType } from '../../api/dealer.types'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { useDealerProfile } from './useDealerProfile'

/**
 * Keeps a page to one kind of dealer. The API enforces the same split (bulk
 * upload: verified business dealers only; manual listing: individuals only),
 * so this is about not showing people screens that would only 403 on them.
 *
 * Fails closed: until the profile has loaded, or if it cannot be loaded, the
 * page is not rendered.
 */
export function RequireDealerType({
  type,
  fallbackTo,
  children,
}: {
  type: DealerType
  fallbackTo: string
  children: ReactNode
}) {
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

  if (profile.data.dealerType !== type) {
    return <Navigate to={fallbackTo} replace />
  }

  return <>{children}</>
}
