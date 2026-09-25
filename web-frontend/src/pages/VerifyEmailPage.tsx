import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { verifyEmail } from '../api/auth.api'
import { toErrorMessage } from '../api/client'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { ResendVerification } from '../components/auth/ResendVerification'

type State =
  | { status: 'loading' }
  | { status: 'success'; role: string }
  | { status: 'error'; message: string }

/**
 * Landing page for the link in the verification email. The token is single
 * use, so the request is guarded against React StrictMode's double effect —
 * a second call would burn the token and show a spurious "invalid" error.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const started = useRef(false)
  const [state, setState] = useState<State>(
    token
      ? { status: 'loading' }
      : { status: 'error', message: 'This verification link is missing its token.' },
  )

  useEffect(() => {
    if (!token || started.current) return
    started.current = true

    verifyEmail(token)
      .then((result) => setState({ status: 'success', role: result.role }))
      .catch((error) =>
        setState({
          status: 'error',
          message: toErrorMessage(
            error,
            'This verification link is invalid or has expired. Request a new one from the sign-in page.',
          ),
        }),
      )
  }, [token])

  if (state.status === 'loading') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Verifying your email…</h1>
          <p role="status">One moment.</p>
        </div>
      </div>
    )
  }

  if (state.status === 'success') {
    const isDealer = state.role === 'DEALER'
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Email verified</h1>
          <p role="status">
            {isDealer
              ? 'Thanks — your email is confirmed. Your dealer account still needs administrator approval before you can sign in.'
              : 'Thanks — your email is confirmed and your account is active.'}
          </p>
          <Link className="button button--primary" to={isDealer ? '/dealer/login' : '/login'}>
            Go to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Verification failed</h1>
        <ErrorBanner message={state.message} />
        <p>Links expire, and only the newest one works. Request a new one below.</p>
        <ResendVerification />
        <Link className="button button--primary" to="/login">
          Go to sign in
        </Link>
      </div>
    </div>
  )
}
