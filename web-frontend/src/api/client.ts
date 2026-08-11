import axios from 'axios'

/**
 * Empty baseURL by default so requests stay same-origin and hit Vite's dev
 * proxy (see vite.config.ts), which forwards /marketplace/* to
 * marketplace-service exactly as nginx does in a real deployment. That keeps
 * request paths identical in dev and production, and avoids CORS locally.
 *
 * Set VITE_API_BASE_URL to point at a deployed gateway instead.
 */
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  timeout: 10000,
})
