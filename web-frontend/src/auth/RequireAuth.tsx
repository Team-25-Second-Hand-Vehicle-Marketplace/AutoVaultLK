import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './useAuth'

/**
 * Gate for routes that need a signed-in user.
 *
 * Waits for `initializing` before deciding: on a hard refresh the stored
 * session hasn't been read yet, and redirecting during that window would
 * bounce an authenticated user to /login on every reload.
 *
 * The attempted location is passed along in state so the login page can
 * return the user where they were headed instead of dumping them on /search.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, initializing } = useAuth()
  const location = useLocation()

  if (initializing) {
    return (
      <div className="route-loading" role="status" aria-live="polite">
        Loading…
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <>{children}</>
}
