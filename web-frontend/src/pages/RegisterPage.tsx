import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../auth/useAuth'
import { toErrorMessage } from '../api/client'

/**
 * Client-side validation carries real weight here, not just UX polish:
 * auth-user-service's RegisterBuyerDto has no class-validator decorators and
 * its main.ts registers no ValidationPipe on this branch, so the API accepts
 * a one-character password and a malformed email without complaint. Strict
 * validation lands on feat/AUS-StrictValicationReq; until then this is the
 * only thing standing between a typo and an unusable account.
 *
 * These rules are intentionally the same ones that branch enforces, so
 * nothing the UI accepts today starts failing when it merges.
 */
const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters'),
    email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
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

type RegisterFormValues = z.infer<typeof registerSchema>

export function RegisterPage() {
  const { register: registerUser } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerSchema) })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const result = await registerUser({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
      })

      // Once email verification ships, registration stops returning tokens
      // and returns a message instead; show it rather than assuming a session.
      if (result.message) {
        setNotice(result.message)
        return
      }
      navigate('/search', { replace: true })
    } catch (error) {
      setFormError(toErrorMessage(error, 'Could not create your account. Please try again.'))
    }
  })

  if (notice) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Almost there</h1>
          <p role="status">{notice}</p>
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
        <h1>Create your account</h1>
        <p className="auth-card__subtitle">
          Save listings and pick up your searches where you left off.
        </p>

        <form onSubmit={onSubmit} noValidate>
          {formError && (
            <div className="form-error form-error--banner" role="alert">
              {formError}
            </div>
          )}

          <label className="form-field">
            <span>Full name</span>
            <input
              type="text"
              autoComplete="name"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'register-name-error' : undefined}
              {...register('name')}
            />
            {errors.name && (
              <span className="form-error" id="register-name-error">
                {errors.name.message}
              </span>
            )}
          </label>

          <label className="form-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'register-email-error' : undefined}
              {...register('email')}
            />
            {errors.email && (
              <span className="form-error" id="register-email-error">
                {errors.email.message}
              </span>
            )}
          </label>

          <label className="form-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'register-password-error' : undefined}
              {...register('password')}
            />
            {errors.password && (
              <span className="form-error" id="register-password-error">
                {errors.password.message}
              </span>
            )}
          </label>

          <label className="form-field">
            <span>Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.confirmPassword)}
              aria-describedby={
                errors.confirmPassword ? 'register-confirm-error' : undefined
              }
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && (
              <span className="form-error" id="register-confirm-error">
                {errors.confirmPassword.message}
              </span>
            )}
          </label>

          <button type="submit" className="button button--primary" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-card__footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
