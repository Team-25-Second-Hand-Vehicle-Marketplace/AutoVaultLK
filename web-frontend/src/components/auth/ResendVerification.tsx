import { useState } from 'react'
import { resendVerification } from '../../api/auth.api'
import { toErrorMessage } from '../../api/client'
import { Button } from '../ui/Button'
import { ErrorBanner } from '../ui/ErrorBanner'
import { FormField } from '../ui/FormField'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface ResendVerificationProps {
  /** Known address (e.g. typed into the login form). Omit to ask for one. */
  email?: string
}

type Status = 'idle' | 'sending' | 'sent'

/**
 * Lets a user whose verification link was lost or expired ask for a new one.
 *
 * The success text is deliberately non-committal ("if that address ..."): the
 * endpoint answers identically for unknown and already-verified addresses so it
 * cannot be used to discover which emails have accounts.
 */
export function ResendVerification({ email: knownEmail }: ResendVerificationProps) {
  const [typedEmail, setTypedEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  const asksForEmail = !knownEmail
  const email = (asksForEmail ? typedEmail : knownEmail).trim()

  const send = async () => {
    setError(null)

    if (!EMAIL_PATTERN.test(email)) {
      setError('Enter the email address you registered with.')
      return
    }

    setStatus('sending')
    try {
      await resendVerification(email)
      setStatus('sent')
    } catch (err) {
      setStatus('idle')
      setError(toErrorMessage(err, 'Could not send the email. Please try again in a few minutes.'))
    }
  }

  return (
    <div className="resend-verification">
      {asksForEmail && (
        <FormField
          label="Email address"
          type="email"
          autoComplete="email"
          value={typedEmail}
          onChange={(event) => setTypedEmail(event.target.value)}
        />
      )}

      <ErrorBanner message={error} />

      {status === 'sent' && (
        <p role="status">
          If <strong>{email}</strong> has an account that is not verified yet, we have sent a new
          link. Check your inbox and spam folder. Only the newest link works.
        </p>
      )}

      <Button variant="ghost" onClick={send} disabled={status === 'sending'}>
        {status === 'sending'
          ? 'Sending…'
          : status === 'sent'
            ? 'Send again'
            : 'Resend verification email'}
      </Button>
    </div>
  )
}
