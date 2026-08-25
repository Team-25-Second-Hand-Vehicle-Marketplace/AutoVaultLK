import axios from 'axios'
import { apiClient } from './client'
import type {
  AuthTokenResponse,
  LoginRequest,
  RegisterBuyerRequest,
  RegisterDealerRequest,
  RegisterResponse,
} from './auth.types'
import { getRefreshToken } from './auth.storage'

/**
 * Every auth call goes through the same /auth prefix nginx exposes, so dev
 * (Vite proxy) and production (gateway) use identical paths.
 */

export async function login(payload: LoginRequest): Promise<AuthTokenResponse> {
  const { data } = await apiClient.post<AuthTokenResponse>('/auth/login', payload)
  return data
}

/** Admin-only login — rejects non-ADMIN accounts server-side. */
export async function loginAdmin(payload: LoginRequest): Promise<AuthTokenResponse> {
  const { data } = await apiClient.post<AuthTokenResponse>('/auth/login/admin', payload)
  return data
}

export async function registerBuyer(payload: RegisterBuyerRequest): Promise<RegisterResponse> {
  const { data } = await apiClient.post<RegisterResponse>('/auth/register/buyer', payload)
  return data
}

export async function registerDealer(payload: RegisterDealerRequest): Promise<RegisterResponse> {
  const { data } = await apiClient.post<RegisterResponse>('/auth/register/dealer', payload)
  return data
}

export async function refreshSession(refreshToken: string): Promise<AuthTokenResponse> {
  const { data } = await axios.post<AuthTokenResponse>(
    `${import.meta.env.VITE_API_BASE_URL ?? ''}/auth/refresh`,
    { refreshToken },
    { timeout: 10000 },
  )
  return data
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return
  try {
    await apiClient.post('/auth/logout', { refreshToken })
  } catch {
  }
}
