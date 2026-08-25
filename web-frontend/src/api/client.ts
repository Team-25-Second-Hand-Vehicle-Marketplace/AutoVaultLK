import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  isAccessTokenExpired,
  saveSession,
} from './auth.storage'

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

let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) throw new Error('No refresh token')

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

apiClient.interceptors.request.use(async (config) => {
  if (isAuthEndpoint(config.url)) return config

  if (getRefreshToken() && isAccessTokenExpired()) {
    try {
      await refreshAccessToken()
    } catch {
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

export function toErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined
    const message = data?.message
    if (Array.isArray(message)) return message.join(', ')
    if (typeof message === 'string') return message
    if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.'
    if (!error.response) return 'Cannot reach the server. Check your connection and try again.'
  }
  return fallback
}
