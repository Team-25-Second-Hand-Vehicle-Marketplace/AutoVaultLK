import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { registerDealer } from '../api/auth.api'
import { isTokenResponse } from '../api/auth.types'
import { saveSession } from '../api/auth.storage'
import { toErrorMessage } from '../api/client'
import { BrandMark } from '../components/layout/BrandMark'

/**
 * Dealer registration, as the four-step wizard in the design reference.
 *
 * Every field maps to a real column on `auth.dealer_profiles` or
 * `auth.users`. The reference's "VAT Number" and "Postcode" inputs are
 * deliberately absent — there are no columns for them, so anything typed
 * would be silently dropped on submit.
 *
 * The whole form is one react-hook-form instance; steps are validation
 * subsets of it, so moving back and forth never loses what was typed.
 */
const schema = z
  .object({
    // Step 1 — company
    companyName: z.string().trim().min(2, 'Company name is required'),
    dealerType: z.enum(['individual', 'business']),
    businessRegistrationNumber: z.string().trim().min(1, 'Registration number is required'),
    businessAddress: z.string().trim().min(4, 'Business address is required'),
    city: z.string().trim().min(2, 'City is required'),

    // Step 2 — contact
    name: z.string().trim().min(2, 'Contact name is required'),
    contactNumber: z
      .string()
      .trim()
      .min(9, 'Enter a valid contact number')
      // Sri Lankan numbers, with or without the +94 country code.
      .regex(/^(\+94|0)?[0-9\s-]{9,15}$/, 'Enter a valid Sri Lankan phone number'),

    // Step 3 — account
    email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[a-z]/, 'Include at least one lowercase letter')
      .regex(/[A-Z]/, 'Include at least one uppercase letter')
      .regex(/[0-9]/, 'Include at least one number'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type FormValues = z.infer<typeof schema>

const STEPS = ['Company Info', 'Contact Details', 'Account Setup', 'Review'] as const

/** Which fields each step is responsible for, for per-step validation. */
const STEP_FIELDS: Array<(keyof FormValues)[]> = [
  ['companyName', 'dealerType', 'businessRegistrationNumber', 'businessAddress', 'city'],
  ['name', 'contactNumber'],
  ['email', 'password', 'confirmPassword'],
  [],
]

export function DealerRegisterPage() {
  const [step, setStep] = useState(0)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { dealerType: 'business' },
  })

  const values = watch()

  const next = async () => {
    // Validate only this step's fields, so a later step's emptiness doesn't
    // block progress through an earlier one.
    const ok = await trigger(STEP_FIELDS[step], { shouldFocus: true })
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const back = () => setStep((s) => Math.max(s - 1, 0))

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null)
    try {
      const result = await registerDealer({
        email: v.email.trim(),
        password: v.password,
        name: v.name.trim(),
        dealerType: v.dealerType,
        businessRegistrationNumber: v.businessRegistrationNumber.trim(),
        businessAddress: v.businessAddress.trim(),
        city: v.city.trim(),
        companyName: v.companyName.trim(),
        contactNumber: v.contactNumber.trim(),
        // No document-upload endpoint exists; the dealer stays PENDING until
        // an admin verifies them, which is the real flow either way.
        verificationDocuments: {},
      })

      if (isTokenResponse(result)) {
        saveSession(result)
        // Full reload so AuthProvider picks the session up as the source of
        // truth rather than duplicating its restore logic here.
        window.location.assign('/')
        return
      }
      setNotice(result.message)
    } catch (error) {
      setFormError(toErrorMessage(error, 'Could not create your dealership account.'))
    }
  })

  if (notice) {
    return (
      <div className="wizard-page">
        <div className="wizard-card wizard-card--message">
          <BrandMark to="/" />
          <h1>Almost there</h1>
          <p role="status">{notice}</p>
          <Link className="button button--primary" to="/dealer/login">
            Go to dealer sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="wizard-page">
      <div className="wizard-page__head">
        <BrandMark to="/" />
      </div>

      <ol className="wizard-steps" aria-label="Registration progress">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={
              i === step
                ? 'wizard-steps__item wizard-steps__item--active'
                : i < step
                  ? 'wizard-steps__item wizard-steps__item--done'
                  : 'wizard-steps__item'
            }
            aria-current={i === step ? 'step' : undefined}
          >
            <span className="wizard-steps__num">{i < step ? '✓' : i + 1}</span>
            <span className="wizard-steps__label">{label}</span>
          </li>
        ))}
      </ol>

      <form className="wizard-card" onSubmit={onSubmit} noValidate>
        {formError && (
          <div className="form-error form-error--banner" role="alert">
            {formError}
          </div>
        )}

        {step === 0 && (
          <>
            <h1>Company Information</h1>
            <p className="wizard-card__subtitle">Tell us about your dealership</p>

            <label className="form-field">
              <span>Company Name *</span>
              <input
                type="text"
                placeholder="e.g. Colombo Auto Traders"
                aria-invalid={Boolean(errors.companyName)}
                {...register('companyName')}
              />
              {errors.companyName && <span className="form-error">{errors.companyName.message}</span>}
            </label>

            <fieldset className="form-field">
              <span className="form-field__legend">Dealer Type *</span>
              <div className="radio-row">
                <label className="radio-card">
                  <input type="radio" value="business" {...register('dealerType')} />
                  <span>
                    <strong>Business</strong>
                    <small>A registered dealership</small>
                  </span>
                </label>
                <label className="radio-card">
                  <input type="radio" value="individual" {...register('dealerType')} />
                  <span>
                    <strong>Individual</strong>
                    <small>Selling in a personal capacity</small>
                  </span>
                </label>
              </div>
            </fieldset>

            <label className="form-field">
              <span>Business Registration Number *</span>
              <input
                type="text"
                placeholder="e.g. PV 12345"
                aria-invalid={Boolean(errors.businessRegistrationNumber)}
                {...register('businessRegistrationNumber')}
              />
              {errors.businessRegistrationNumber && (
                <span className="form-error">{errors.businessRegistrationNumber.message}</span>
              )}
            </label>

            <label className="form-field">
              <span>Business Address *</span>
              <input
                type="text"
                placeholder="Street address"
                aria-invalid={Boolean(errors.businessAddress)}
                {...register('businessAddress')}
              />
              {errors.businessAddress && (
                <span className="form-error">{errors.businessAddress.message}</span>
              )}
            </label>

            <label className="form-field">
              <span>City *</span>
              <input
                type="text"
                placeholder="e.g. Colombo"
                aria-invalid={Boolean(errors.city)}
                {...register('city')}
              />
              {errors.city && <span className="form-error">{errors.city.message}</span>}
            </label>
          </>
        )}

        {step === 1 && (
          <>
            <h1>Contact Details</h1>
            <p className="wizard-card__subtitle">How buyers and our team reach you</p>

            <label className="form-field">
              <span>Contact Name *</span>
              <input
                type="text"
                autoComplete="name"
                placeholder="Full name"
                aria-invalid={Boolean(errors.name)}
                {...register('name')}
              />
              {errors.name && <span className="form-error">{errors.name.message}</span>}
            </label>

            <label className="form-field">
              <span>Contact Number *</span>
              <input
                type="tel"
                autoComplete="tel"
                placeholder="e.g. +94 11 234 5678"
                aria-invalid={Boolean(errors.contactNumber)}
                {...register('contactNumber')}
              />
              {errors.contactNumber && (
                <span className="form-error">{errors.contactNumber.message}</span>
              )}
            </label>
          </>
        )}

        {step === 2 && (
          <>
            <h1>Account Setup</h1>
            <p className="wizard-card__subtitle">Credentials for your dealer sign-in</p>

            <label className="form-field">
              <span>Email Address *</span>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@dealership.lk"
                aria-invalid={Boolean(errors.email)}
                {...register('email')}
              />
              {errors.email && <span className="form-error">{errors.email.message}</span>}
            </label>

            <label className="form-field">
              <span>Password *</span>
              <input
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                {...register('password')}
              />
              {errors.password && <span className="form-error">{errors.password.message}</span>}
            </label>

            <label className="form-field">
              <span>Confirm Password *</span>
              <input
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.confirmPassword)}
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <span className="form-error">{errors.confirmPassword.message}</span>
              )}
            </label>
          </>
        )}

        {step === 3 && (
          <>
            <h1>Review</h1>
            <p className="wizard-card__subtitle">Check the details before submitting</p>

            <dl className="review-list">
              <div>
                <dt>Company</dt>
                <dd>{values.companyName || '—'}</dd>
              </div>
              <div>
                <dt>Dealer type</dt>
                <dd>{values.dealerType === 'business' ? 'Business' : 'Individual'}</dd>
              </div>
              <div>
                <dt>Registration no.</dt>
                <dd>{values.businessRegistrationNumber || '—'}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>
                  {[values.businessAddress, values.city].filter(Boolean).join(', ') || '—'}
                </dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd>
                  {values.name || '—'}
                  {values.contactNumber ? ` · ${values.contactNumber}` : ''}
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{values.email || '—'}</dd>
              </div>
            </dl>

            <p className="wizard-card__note">
              New dealerships start as <strong>Pending</strong>. An administrator verifies the
              account before the “Verified” badge appears on your listings.
            </p>
          </>
        )}

        <div className="wizard-card__actions">
          {step === 0 ? (
            <Link to="/dealer/login" className="button button--ghost">
              ← Back to Login
            </Link>
          ) : (
            <button type="button" className="button button--ghost" onClick={back}>
              ← Back
            </button>
          )}

          {step < STEPS.length - 1 ? (
            <button type="button" className="button button--primary" onClick={next}>
              Continue →
            </button>
          ) : (
            <button type="submit" className="button button--primary" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Create Dealer Account'}
            </button>
          )}
        </div>
      </form>

      <p className="wizard-page__foot">
        Already have an account? <Link to="/dealer/login">Sign in</Link>
      </p>
    </div>
  )
}
