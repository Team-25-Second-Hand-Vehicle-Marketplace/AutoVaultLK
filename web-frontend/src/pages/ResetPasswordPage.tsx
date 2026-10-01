import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { confirmPasswordReset } from '../api/auth.api'
import { toErrorMessage } from '../api/client'
import { Button } from '../components/ui/Button'
import { FormField } from '../components/ui/FormField'
import { ErrorBanner } from '../components/ui/ErrorBanner'

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[a-z]/, 'Include at least one lowercase letter')
      .regex(/[A-Z]/, 'Include at least one uppercase letter')
      .regex(/[0-9]/, 'Include at least one number'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>

/** Landing page for the link in the password-reset email. */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({ resolver: zodResolver(resetPasswordSchema) })

  const onSubmit = handleSubmit(async (values) => {
    if (!token) return
    setFormError(null)
    try {
      await confirmPasswordReset(token, values.password)
      setDone(true)
    } catch (error) {
      setFormError(
        toErrorMessage(
          error,
          'This reset link is invalid or has expired. Request a new one from the sign-in page.',
        ),
      )
    }
  })

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Reset link is missing its token</h1>
          <p>This link is incomplete. Request a new one from the forgot-password page.</p>
          <Link className="button button--primary" to="/forgot-password">
            Request a new link
          </Link>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Password reset</h1>
          <p role="status">Your password has been reset. You can now sign in with it.</p>
          <Link className="button button--primary" to="/login">
            Go to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Choose a new password</h1>

        <form onSubmit={onSubmit} noValidate>
          <ErrorBanner message={formError} />

          <FormField
            label="New password"
            type="password"
            autoComplete="new-password"
            error={errors.password?.message}
            {...register('password')}
          />

          <FormField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />

          <Button type="submit" block disabled={isSubmitting}>
            {isSubmitting ? 'Resetting…' : 'Reset password'}
          </Button>
        </form>

        {formError && (
          <p className="auth-card__footer">
            <Link to="/forgot-password">Request a new link</Link>
          </p>
        )}
      </div>
    </div>
  )
}
