import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../../auth/useAuth'
import { toErrorMessage } from '../../api/client'
import { BrandMark } from '../../components/layout/BrandMark'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { ErrorBanner } from '../../components/ui/ErrorBanner'

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type FormValues = z.infer<typeof schema>

/**
 * Administrator sign-in via POST /auth/login/admin.
 * Non-ADMIN accounts are rejected by the auth service.
 */
export function AdminLoginPage() {
  const { loginAdmin, user, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (isAuthenticated && user?.role === 'ADMIN') {
      navigate('/admin', { replace: true })
    }
  }, [isAuthenticated, user, navigate])

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await loginAdmin(values.email, values.password)
      navigate('/admin', { replace: true })
    } catch (error) {
      setFormError(toErrorMessage(error, 'Could not sign you in. Please try again.'))
    }
  })

  return (
    <div className="admin-auth">
      <aside className="admin-auth__panel">
        <BrandMark to={null} />
        <div className="admin-auth__panel-body">
          <p className="admin-auth__eyebrow">Operations</p>
          <h1>Admin console</h1>
          <p>Manage dealers, monitor uploads, and review audit activity for AutoVaultLK.</p>
        </div>
      </aside>

      <main className="admin-auth__form-side">
        <div className="admin-auth__form-wrap">
          <h2>Admin sign in</h2>
          <p className="admin-auth__subtitle">Use your administrator account</p>

          <form onSubmit={onSubmit} noValidate>
            <ErrorBanner message={formError} />

            <FormField
              label="Email"
              type="email"
              autoComplete="username"
              placeholder="admin@autovault.lk"
              error={errors.email?.message}
              {...register('email')}
            />

            <FormField
              label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              error={errors.password?.message}
              {...register('password')}
            />

            <Button type="submit" size="lg" block disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="admin-auth__back">
            <Link to="/">← Back to AutoVaultLK</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
