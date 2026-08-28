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
import { getMarketplaceStats } from '../../api/search.api'
import type { MarketplaceStats } from '../../api/search.types'

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type FormValues = z.infer<typeof schema>

/**
 * Dealer sign-in.
 *
 * There is no separate dealer login endpoint — `POST /auth/login` serves both
 * buyers and dealers and returns the account's role. So this page posts to the
 * same endpoint and then checks the role: a BUYER who signs in here is told
 * plainly that the account isn't a dealer account, rather than being dropped
 * into a portal that has nothing for them.
 */
export function DealerLoginPage() {
  const { login, logout, user, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)
  const [stats, setStats] = useState<MarketplaceStats | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    const controller = new AbortController()
    getMarketplaceStats(controller.signal)
      .then(setStats)
      .catch(() => {
        // Decorative panel figures — a failure here must not block sign-in.
      })
    return () => controller.abort()
  }, [])

  // An already-signed-in dealer has nothing to do here.
  useEffect(() => {
    if (isAuthenticated && user?.role === 'DEALER') navigate('/', { replace: true })
  }, [isAuthenticated, user, navigate])

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await login(values.email, values.password)
    } catch (error) {
      setFormError(toErrorMessage(error, 'Could not sign you in. Please try again.'))
      return
    }

    // login() has stored the session; read the role back from storage rather
    // than waiting for the context to re-render.
    const raw = localStorage.getItem('autovault.user')
    const role = raw ? (JSON.parse(raw) as { role?: string }).role : undefined

    if (role !== 'DEALER') {
      // Don't leave a half-signed-in buyer sitting on the dealer portal.
      await logout()
      setFormError(
        'That account is not a dealer account. Use the main sign-in, or register a dealership.',
      )
      return
    }

    navigate('/', { replace: true })
  })

  return (
    <div className="dealer-auth">
      <aside className="dealer-auth__panel">
        <BrandMark to="/" />

        <div className="dealer-auth__panel-body">
          <h1>Welcome back to the Dealer Portal</h1>
          <p>
            Manage your vehicle listings and reach buyers searching across Sri Lanka.
          </p>

          <div className="dealer-auth__stats">
            <div>
              <strong>{stats ? stats.vehicleCount.toLocaleString('en-LK') : '—'}</strong>
              <span>Live listings</span>
            </div>
            <div>
              <strong>{stats ? stats.verifiedDealerCount : '—'}</strong>
              <span>Verified dealers</span>
            </div>
            <div>
              <strong>{stats ? stats.makeCount : '—'}</strong>
              <span>Brands listed</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="dealer-auth__form-side">
        <div className="dealer-auth__form-wrap">
          <h2>Dealer Sign In</h2>
          <p className="dealer-auth__subtitle">Access your dealer account to manage listings</p>

          <form onSubmit={onSubmit} noValidate>
            <ErrorBanner message={formError} />

            <FormField
              label="Email Address"
              type="email"
              autoComplete="email"
              placeholder="you@dealership.lk"
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

            {/* The reference shows "Remember me" and "Forgot password?" here.
                Sessions already persist across reloads, and no password-reset
                endpoint exists on this branch, so neither control is shown
                rather than rendering one that does nothing. */}

            <Button type="submit" size="lg" block disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>

          <p className="dealer-auth__footer">
            Not a dealer yet? <Link to="/dealer/register">Register your dealership</Link>
          </p>

          <p className="dealer-auth__back">
            <Link to="/">← Back to AutoVaultLK</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
