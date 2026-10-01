import { createContext } from 'react'
import type { AuthUser, RegisterBuyerRequest } from '../api/auth.types'

export interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  /** True until the stored session has been read - routes must wait on this. */
  initializing: boolean
  login: (email: string, password: string) => Promise<void>
  /** Admin portal sign-in via POST /auth/login/admin. */
  loginAdmin: (email: string, password: string) => Promise<void>
  /** "Continue with Google" - idToken from Google Identity Services. */
  loginWithGoogle: (idToken: string) => Promise<void>
  /** Resolves to a message when the backend requires email verification. */
  register: (payload: RegisterBuyerRequest) => Promise<{ message?: string }>
  logout: () => Promise<void>
  /** Merges into the signed-in user and persists it - e.g. after a self-service name change. */
  updateUser: (patch: Partial<AuthUser>) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
