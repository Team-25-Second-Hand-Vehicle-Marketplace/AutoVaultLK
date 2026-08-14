import { jwtDecode } from 'jwt-decode'
import type { AccessTokenPayload, AuthUser } from './auth.types'

/**
 * Session persistence.
 *
 * localStorage, not memory: a buyer who refreshes the page mid-search should
 * stay logged in. The tradeoff is XSS exposure — a script injected into this
 * origin can read these tokens. The mitigations that matter here are the
 * short access-token lifetime (15m by default, see JWT_ACCESS_EXPIRES_IN) and
 * that refresh tokens are single-use and revoked server-side on rotation.
 *
 * httpOnly cookies would be strictly better, but the auth service returns
 * tokens in the response body and has no cookie/CSRF handling on this branch
 * (a CsrfGuard exists on feat/AUS-jwt-auth-guard, unmerged). Matching the
 * contract that actually exists beats inventing a half-cookie scheme.
 */

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

/**
 * The cached user, or null if absent/corrupt.
 *
 * Treated as a display convenience only (greeting, nav state) — never as
 * proof of anything. A user who edits localStorage to say role: 'ADMIN'
 * changes what this returns and nothing else: every protected read is
 * authorized by the backend against the signed token.
 */
export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    // Corrupt entry (hand-edited, or written by an older version) — drop the
    // whole session rather than leaving tokens paired with an unreadable user.
    clearSession()
    return null
  }
}

/**
 * True when the access token is missing, unparseable, or within `skewSeconds`
 * of expiry. Used to refresh proactively instead of waiting for a 401.
 */
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
