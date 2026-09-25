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

export type VerifyEmailResponse = {
  message: string
  emailVerified: boolean
  role: string
}

/**
 * POST /auth/email/resend-verification. The server answers the same way
 * whether or not the address exists or is already verified (no account
 * enumeration), so callers must not imply an email definitely went out.
 */
export async function resendVerification(email: string): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/auth/email/resend-verification', {
    email,
  })
  return { message: data.message }
}

/** POST /auth/email/verify — consumes the token from the emailed link. */
export async function verifyEmail(token: string): Promise<VerifyEmailResponse> {
  const { data } = await apiClient.post<VerifyEmailResponse>('/auth/email/verify', { token })
  return data
}

/**
 * POST /documents/verification — uploads a business registration certificate
 * before the dealer account exists, returning a stored key. That key is what
 * gets sent as verificationDocuments.businessRegistrationCertificate on the
 * actual registerDealer call.
 */
export async function uploadVerificationDocument(
  file: File,
  signal?: AbortSignal,
): Promise<{ key: string }> {
  const form = new FormData()
  form.append('document', file)

  const { data } = await apiClient.post<{ key: string }>('/documents/verification', form, {
    signal,
  })
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
    return
  }
}
