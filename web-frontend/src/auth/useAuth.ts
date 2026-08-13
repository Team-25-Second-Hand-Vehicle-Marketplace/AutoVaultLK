import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './auth-context'

/**
 * Separate from AuthContext.tsx so that file exports only components —
 * mixing a hook export into it breaks react-refresh's fast-refresh
 * boundary (eslint-plugin-react-refresh flags exactly this).
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return context
}
