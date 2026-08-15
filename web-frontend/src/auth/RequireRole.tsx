import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { UserRole } from '../api/auth.types'
import { useAuth } from './useAuth'

/**
 * Requires a signed-in user with the given role.
 * Unauthenticated users go to `loginTo`; wrong-role users are signed out
 * of the protected area by redirecting to the role-specific login.
 */
export function RequireRole({
  role,
  loginTo,
  children,
}: {
  role: UserRole
  loginTo: string
  children: ReactNode
}) {
  const { user, isAuthenticated, initializing } = useAuth()
  const location = useLocation()

  if (initializing) {
    return (
      <div className="route-loading" role="status" aria-live="polite">
        Loading…
      </div>
    )
  }

  if (!isAuthenticated || user?.role !== role) {
    return <Navigate to={loginTo} replace state={{ from: location }} />
  }

  return <>{children}</>
}
