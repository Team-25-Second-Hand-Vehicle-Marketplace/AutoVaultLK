import { jwtDecode } from 'jwt-decode'
import type { AccessTokenPayload, AuthUser } from './auth.types'


const ACCESS_TOKEN_KEY = 'autovault.accessToken'
const HAS_SESSION_KEY = 'autovault.hasSession'
const USER_KEY = 'autovault.user'
const CSRF_TOKEN_KEY = 'autovault.csrfToken'

export interface StoredSession {
  accessToken: string
  csrfToken?: string
  user: AuthUser
}

export function saveSession(session: StoredSession): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken)
  localStorage.setItem(USER_KEY, JSON.stringify(session.user))
  if (session.csrfToken) localStorage.setItem(CSRF_TOKEN_KEY, session.csrfToken)
  // The refresh token itself lives only in an httpOnly cookie the browser
  // manages - this flag just records that one was issued, so the client
  // knows a silent refresh is worth attempting. It carries no security
  // weight; the cookie (and the server-side token it points to) does that.
  localStorage.setItem(HAS_SESSION_KEY, '1')
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(HAS_SESSION_KEY)
  localStorage.removeItem(CSRF_TOKEN_KEY)
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function hasSession(): boolean {
  return localStorage.getItem(HAS_SESSION_KEY) === '1'
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

/**
 * Overwrites just the stored user (tokens untouched) - for after a
 * self-service profile edit (e.g. name), so a page refresh still shows the
 * new value instead of the one from login/registration.
 */
export function setStoredUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

/**
 * The CSRF value the server returned with the last login, registration or
 * refresh. It is kept here, not read from the API's cookie, because the API
 * is on a different site from the SPA and its cookies are not visible to JS.
 */
export function getCsrfToken(): string | null {
  return localStorage.getItem(CSRF_TOKEN_KEY)
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
