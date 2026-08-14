import { createContext } from 'react'
import type { AuthUser, RegisterBuyerRequest } from '../api/auth.types'

export interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  /** True until the stored session has been read — routes must wait on this. */
  initializing: boolean
  login: (email: string, password: string) => Promise<void>
  /** Resolves to a message when the backend requires email verification. */
  register: (payload: RegisterBuyerRequest) => Promise<{ message?: string }>
  logout: () => Promise<void>
}

/**
 * Lives in its own module so AuthContext.tsx exports only components, which
 * is what react-refresh needs to hot-reload the provider without dropping
 * the session on every edit.
 */
export const AuthContext = createContext<AuthContextValue | null>(null)
