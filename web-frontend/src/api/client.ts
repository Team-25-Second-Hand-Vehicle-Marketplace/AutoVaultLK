import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  isAccessTokenExpired,
  saveSession,
} from './auth.storage'

/**
 * Empty baseURL by default so requests stay same-origin and hit Vite's dev
 * proxy (see vite.config.ts), which forwards /marketplace/* and /auth/* to
 * their services exactly as nginx does in a real deployment. That keeps
 * request paths identical in dev and production, and avoids CORS locally.
 *
 * Set VITE_API_BASE_URL to point at a deployed gateway instead.
 */
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  timeout: 10000,
})

/** Notifies the app (AuthProvider) that the session ended and cannot be revived. */
type SessionExpiredHandler = () => void
let onSessionExpired: SessionExpiredHandler = () => {}

export function setSessionExpiredHandler(handler: SessionExpiredHandler): void {
  onSessionExpired = handler
}

/**
 * Single-flight refresh.
 *
 * Without this, a page that fires several requests at once (search + options
 * + facets) would, on an expired token, kick off one refresh per request.
 * Refresh tokens are single-use and revoked on rotation server-side, so the
 * first would succeed and the rest would 401 with an already-revoked token,
 * logging the user out mid-session. Every caller awaits the same promise.
 */
let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) throw new Error('No refresh token')

    // Imported lazily to break the cycle: auth.api imports this module for
    // apiClient, and this module needs auth.api's refreshSession.
    const { refreshSession } = await import('./auth.api')
    const session = await refreshSession(refreshToken)
    saveSession(session)
    return session.accessToken
  })()

  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

/** Endpoints that must never carry a token or trigger a refresh. */
function isAuthEndpoint(url: string | undefined): boolean {
  return Boolean(url && /\/auth\/(login|register|refresh)/.test(url))
}

/**
 * Attach the access token, refreshing first if it is already expired.
 *
 * Refreshing proactively (rather than only reacting to a 401) means a user
 * returning to a tab after the 15-minute access-token lifetime doesn't see a
 * failed request flash before the retry succeeds.
 */
apiClient.interceptors.request.use(async (config) => {
  if (isAuthEndpoint(config.url)) return config

  if (getRefreshToken() && isAccessTokenExpired()) {
    try {
      await refreshAccessToken()
    } catch {
      // Fall through unauthenticated: public endpoints (search, options,
      // vehicle detail) still work fine without a token, and anything
      // protected will 401 and be handled below.
      clearSession()
      onSessionExpired()
    }
  }

  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/**
 * Retry once on 401 with a refreshed token.
 *
 * Covers the case the request interceptor can't: a token that was still valid
 * when sent but was rejected anyway (revoked server-side, secret rotated,
 * clock skew). `_retried` guards against an infinite 401 loop.
 */
interface RetriableRequest extends InternalAxiosRequestConfig {
  _retried?: boolean
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableRequest | undefined

    if (
      error.response?.status !== 401 ||
      !config ||
      config._retried ||
      isAuthEndpoint(config.url) ||
      !getRefreshToken()
    ) {
      return Promise.reject(error)
    }

    config._retried = true
    try {
      const token = await refreshAccessToken()
      config.headers.Authorization = `Bearer ${token}`
      return apiClient(config)
    } catch {
      clearSession()
      onSessionExpired()
      return Promise.reject(error)
    }
  },
)

/**
 * Turns an axios failure into something worth showing a user.
 *
 * Distinguishes the three cases that need different wording: the server said
 * why (use its message), the request never got a response (network/timeout),
 * or something else entirely.
 */
export function toErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined
    const message = data?.message
    // Nest's ValidationPipe returns message as an array of field errors.
    if (Array.isArray(message)) return message.join(', ')
    if (typeof message === 'string') return message
    if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.'
    if (!error.response) return 'Cannot reach the server. Check your connection and try again.'
  }
  return fallback
}
