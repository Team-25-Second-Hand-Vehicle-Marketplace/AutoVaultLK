import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../auth/useAuth'
import { toErrorMessage } from '../api/client'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginFormValues = z.infer<typeof loginSchema>

interface RedirectState {
  from?: { pathname: string }
}

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) })

  // Return the user to whatever they were trying to reach, defaulting to
  // search. RequireAuth stashes this on redirect.
  const redirectTo = (location.state as RedirectState | null)?.from?.pathname ?? '/search'

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await login(values.email, values.password)
      navigate(redirectTo, { replace: true })
    } catch (error) {
      // The service returns 401 "Invalid email or password" for both an
      // unknown email and a wrong password — deliberately not distinguished
      // here either, since doing so would confirm which emails are registered.
      setFormError(toErrorMessage(error, 'Could not sign you in. Please try again.'))
    }
  })

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Welcome back</h1>
        <p className="auth-card__subtitle">Sign in to save listings and manage your searches.</p>

        <form onSubmit={onSubmit} noValidate>
          {formError && (
            <div className="form-error form-error--banner" role="alert">
              {formError}
            </div>
          )}

          <label className="form-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              // Surfaces the field to assistive tech as invalid, and links it
              // to the message below without relying on visual proximity.
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'login-email-error' : undefined}
              {...register('email')}
            />
            {errors.email && (
              <span className="form-error" id="login-email-error">
                {errors.email.message}
              </span>
            )}
          </label>

          <label className="form-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'login-password-error' : undefined}
              {...register('password')}
            />
            {errors.password && (
              <span className="form-error" id="login-password-error">
                {errors.password.message}
              </span>
            )}
          </label>

          <button type="submit" className="button button--primary" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="auth-card__footer">
          Don't have an account? <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  )
}
