import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as authApi from '../api/auth.api'
import { setSessionExpiredHandler } from '../api/client'
import {
  clearSession,
  getStoredUser,
  getRefreshToken,
  saveSession,
} from '../api/auth.storage'
import { isTokenResponse, type AuthUser, type RegisterBuyerRequest } from '../api/auth.types'
import { AuthContext, type AuthContextValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [initializing, setInitializing] = useState(true)

  /**
   * Restore the session synchronously from localStorage on mount.
   *
   * Only trusted far enough to render a logged-in shell immediately — the
   * token still has to satisfy the backend on the first protected request,
   * and the client's interceptor will refresh or clear it as needed.
   */
  useEffect(() => {
    const stored = getStoredUser()
    if (stored && getRefreshToken()) {
      setUser(stored)
    } else {
      // A user without a refresh token can't recover from expiry; treat the
      // half-present session as no session at all.
      clearSession()
    }
    setInitializing(false)
  }, [])

  /**
   * The axios client can't import this provider (it isn't React-aware), so it
   * calls back here when a refresh fails and the session is unrecoverable.
   */
  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null))
    return () => setSessionExpiredHandler(() => {})
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const session = await authApi.login({ email, password })
    saveSession(session)
    setUser(session.user)
  }, [])

  const loginAdmin = useCallback(async (email: string, password: string) => {
    const session = await authApi.loginAdmin({ email, password })
    saveSession(session)
    setUser(session.user)
  }, [])

  const register = useCallback(async (payload: RegisterBuyerRequest) => {
    const result = await authApi.registerBuyer(payload)
    // Today the service returns tokens and logs the user straight in. Once
    // email verification merges it will return { message } instead; handling
    // both here means that change needs no frontend edit.
    if (isTokenResponse(result)) {
      saveSession(result)
      setUser(result.user)
      return {}
    }
    return { message: result.message }
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    clearSession()
    setUser(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      initializing,
      login,
      loginAdmin,
      register,
      logout,
    }),
    [user, initializing, login, loginAdmin, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
