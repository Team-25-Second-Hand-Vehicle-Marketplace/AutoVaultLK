import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as authApi from '../api/auth.api'
import { setSessionExpiredHandler } from '../api/client'
import {
  clearSession,
  getStoredUser,
  getRefreshToken,
  saveSession,
  setStoredUser,
} from '../api/auth.storage'
import { isTokenResponse, type AuthUser, type RegisterBuyerRequest } from '../api/auth.types'
import { AuthContext, type AuthContextValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {

  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = getStoredUser()
    if (stored && getRefreshToken()) return stored
    // A user without a refresh token can't recover from expiry; treat the
    // half-present session as no session at all.
    clearSession()
    return null
  })

  const [initializing] = useState(false)

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

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((current) => {
      if (!current) return current
      const next = { ...current, ...patch }
      setStoredUser(next)
      return next
    })
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
      updateUser,
    }),
    [user, initializing, login, loginAdmin, register, logout, updateUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
