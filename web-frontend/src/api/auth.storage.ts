import { jwtDecode } from 'jwt-decode'
import type { AccessTokenPayload, AuthUser } from './auth.types'


const ACCESS_TOKEN_KEY = 'autovault.accessToken'
const REFRESH_TOKEN_KEY = 'autovault.refreshToken'
const USER_KEY = 'autovault.user'

export interface StoredSession {
  accessToken: string
  refreshToken: string
  user: AuthUser
}

export function saveSession(session: StoredSession): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken)
  localStorage.setItem(USER_KEY, JSON.stringify(session.user))
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    clearSession()
    return null
  }
}


export function isAccessTokenExpired(skewSeconds = 30): boolean {
  const token = getAccessToken()
  if (!token) return true
  try {
    const { exp } = jwtDecode<AccessTokenPayload>(token)
    return exp * 1000 - Date.now() <= skewSeconds * 1000
  } catch {
    return true
  }
}
