import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { requestPasswordReset } from '../api/auth.api'
import { toErrorMessage } from '../api/client'
import { Button } from '../components/ui/Button'
import { FormField } from '../components/ui/FormField'
import { ErrorBanner } from '../components/ui/ErrorBanner'

const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
})

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>

/**
 * The server answers identically whether or not the address has an account
 * (see AUTH_SECURITY_MESSAGES.PASSWORD_RESET_RECEIVED) so it can't be used to
 * discover which emails are registered - the success state here must stay
 * just as non-committal, same as ResendVerification's wording.
 */
export function ForgotPasswordPage() {
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({ resolver: zodResolver(forgotPasswordSchema) })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await requestPasswordReset(values.email)
      setSubmittedEmail(values.email)
    } catch (error) {
      setFormError(toErrorMessage(error, 'Could not send the email. Please try again in a few minutes.'))
    }
  })

  if (submittedEmail) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Check your email</h1>
          <p role="status">
            If <strong>{submittedEmail}</strong> has an account, we have sent instructions to reset
            your password. Check your inbox and spam folder - the link expires after a while, and
            only the newest one works.
          </p>
          <Link className="button button--primary" to="/login">
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Forgot your password?</h1>
        <p className="auth-card__subtitle">
          Enter the email address on your account and we'll send you a link to reset it.
        </p>

        <form onSubmit={onSubmit} noValidate>
          <ErrorBanner message={formError} />

          <FormField
            label="Email"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />

          <Button type="submit" block disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>

        <p className="auth-card__footer">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
