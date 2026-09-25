import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { registerDealer, uploadVerificationDocument } from '../../api/auth.api'
import { isTokenResponse } from '../../api/auth.types'
import { saveSession } from '../../api/auth.storage'
import { toErrorMessage } from '../../api/client'
import { BrandMark } from '../../components/layout/BrandMark'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { ErrorBanner } from '../../components/ui/ErrorBanner'

/** Mirrors auth-user-service's DocumentUploadService limits exactly. */
const ACCEPTED_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png']
const MAX_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024

/** Sri Lankan NIC: old format (9 digits + V/X) or new format (12 digits) — matches the backend's NIC_REGEX. */
const NIC_REGEX = /^(?:\d{9}[vVxX]|\d{12})$/

/** Small fixed set of dial codes — Sri Lanka first/default since this is a Sri Lankan marketplace. */
const COUNTRY_CODES = [
  { code: '+94', label: '🇱🇰 +94 (Sri Lanka)' },
  { code: '+91', label: '🇮🇳 +91 (India)' },
  { code: '+1', label: '🇺🇸 +1 (US/Canada)' },
  { code: '+44', label: '🇬🇧 +44 (UK)' },
  { code: '+61', label: '🇦🇺 +61 (Australia)' },
] as const

const schema = z
  .object({
    // Step 1 — company
    companyName: z.string().trim().min(2, 'Company name is required'),
    dealerType: z.enum(['individual', 'business']),
    businessRegistrationNumber: z.string().trim().min(1, 'Registration number is required'),
    businessAddress: z.string().trim().min(4, 'Business address is required'),
    city: z.string().trim().min(2, 'City is required'),
    // Individual dealers only — an NIC is a known-format identifier, so it's
    // typed as text rather than uploaded as a document scan.
    nicNumber: z.string().trim().optional(),

    // Step 2 — contact
    name: z.string().trim().min(2, 'Contact name is required'),
    countryCode: z.enum(COUNTRY_CODES.map((c) => c.code) as [string, ...string[]]),
    // Local number only — no leading 0, no country code. The backend's
    // PHONE_REGEX (^\+?[1-9]\d{8,14}$) is applied to countryCode + this
    // combined, so this stays digits-only and matches what's left of a
    // Sri Lankan number once its leading 0 is stripped.
    contactNumber: z
      .string()
      .trim()
      .regex(/^[1-9]\d{7,10}$/, 'Enter a valid phone number, without the leading 0'),

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
  .refine((v) => v.dealerType !== 'individual' || NIC_REGEX.test(v.nicNumber ?? ''), {
    message: 'Enter a valid NIC (9 digits + V/X, or 12 digits)',
    path: ['nicNumber'],
  })

type FormValues = z.infer<typeof schema>

const STEPS = ['Company Info', 'Contact Details', 'Account Setup', 'Review'] as const

/** Which fields each step is responsible for, for per-step validation. */
const STEP_FIELDS: Array<(keyof FormValues)[]> = [
  ['companyName', 'dealerType', 'businessRegistrationNumber', 'businessAddress', 'city', 'nicNumber'],
  ['name', 'countryCode', 'contactNumber'],
  ['email', 'password', 'confirmPassword'],
  [],
]

export function DealerRegisterPage() {
  const [step, setStep] = useState(0)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [documentKey, setDocumentKey] = useState<string | null>(null)
  const [documentName, setDocumentName] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [documentUploading, setDocumentUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { dealerType: 'business', countryCode: '+94' },
  })

  const values = watch()

  const onDocumentSelected = async (fileList: FileList | null) => {
    setDocumentError(null)
    const file = fileList?.[0]
    if (!file) return

    if (!ACCEPTED_DOCUMENT_TYPES.includes(file.type)) {
      setDocumentError('Choose a PDF, JPEG or PNG file')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      setDocumentError(`File is larger than ${MAX_DOCUMENT_SIZE_BYTES / 1024 / 1024} MB`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setDocumentUploading(true)
    try {
      const { key } = await uploadVerificationDocument(file)
      setDocumentKey(key)
      setDocumentName(file.name)
    } catch (error) {
      setDocumentError(toErrorMessage(error, 'Could not upload the document.'))
      if (fileInputRef.current) fileInputRef.current.value = ''
    } finally {
      setDocumentUploading(false)
    }
  }

  const next = async () => {
    // Validate only this step's fields, so a later step's emptiness doesn't
    // block progress through an earlier one.
    const ok = await trigger(STEP_FIELDS[step], { shouldFocus: true })
    if (!ok) return

    if (step === 0 && values.dealerType === 'business' && !documentKey) {
      setDocumentError('Upload your business registration certificate to continue')
      return
    }

    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const back = () => setStep((s) => Math.max(s - 1, 0))

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null)
    try {
      const verificationDocuments =
        v.dealerType === 'business'
          ? { businessRegistrationCertificate: documentKey ?? '' }
          : { nic: (v.nicNumber ?? '').trim() }

      const result = await registerDealer({
        email: v.email.trim(),
        password: v.password,
        name: v.name.trim(),
        dealerType: v.dealerType,
        businessRegistrationNumber: v.businessRegistrationNumber.trim(),
        businessAddress: v.businessAddress.trim(),
        city: v.city.trim(),
        companyName: v.companyName.trim(),
        contactNumber: `${v.countryCode}${v.contactNumber.trim()}`,
        verificationDocuments,
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
        <ErrorBanner message={formError} />

        {step === 0 && (
          <>
            <h1>Company Information</h1>
            <p className="wizard-card__subtitle">Tell us about your dealership</p>

            <FormField
              label="Company Name *"
              type="text"
              placeholder="e.g. Colombo Auto Traders"
              error={errors.companyName?.message}
              {...register('companyName')}
            />

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

            <FormField
              label="Business Registration Number *"
              type="text"
              placeholder="e.g. PV 12345"
              error={errors.businessRegistrationNumber?.message}
              {...register('businessRegistrationNumber')}
            />

            <FormField
              label="Business Address *"
              type="text"
              placeholder="Street address"
              error={errors.businessAddress?.message}
              {...register('businessAddress')}
            />

            <FormField
              label="City *"
              type="text"
              placeholder="e.g. Colombo"
              error={errors.city?.message}
              {...register('city')}
            />

            {values.dealerType === 'individual' ? (
              <FormField
                label="NIC Number *"
                type="text"
                placeholder="e.g. 200012345678 or 991234567V"
                error={errors.nicNumber?.message}
                {...register('nicNumber')}
              />
            ) : (
              <div className="form-field">
                <span>Business Registration Certificate *</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_DOCUMENT_TYPES.join(',')}
                  onChange={(e) => onDocumentSelected(e.target.files)}
                />
                <span className="upload-field__hint">
                  PDF, JPEG or PNG, up to {MAX_DOCUMENT_SIZE_BYTES / 1024 / 1024} MB.
                </span>
                {documentUploading && (
                  <span className="upload-field__hint">Uploading…</span>
                )}
                {documentName && !documentUploading && (
                  <span className="upload-field__hint">Uploaded: {documentName}</span>
                )}
                {documentError && <span className="form-error">{documentError}</span>}
              </div>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <h1>Contact Details</h1>
            <p className="wizard-card__subtitle">How buyers and our team reach you</p>

            <FormField
              label="Contact Name *"
              type="text"
              autoComplete="name"
              placeholder="Full name"
              error={errors.name?.message}
              {...register('name')}
            />

            <div className="form-field">
              <span>Contact Number *</span>
              <div className="phone-field">
                <select
                  className="phone-field__code"
                  aria-label="Country code"
                  {...register('countryCode')}
                >
                  {COUNTRY_CODES.map(({ code, label }) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  autoComplete="tel-national"
                  placeholder="e.g. 701234567"
                  aria-invalid={Boolean(errors.contactNumber)}
                  {...register('contactNumber')}
                />
              </div>
              {errors.contactNumber && (
                <span className="form-error">{errors.contactNumber.message}</span>
              )}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>Account Setup</h1>
            <p className="wizard-card__subtitle">Credentials for your dealer sign-in</p>

            <FormField
              label="Email Address *"
              type="email"
              autoComplete="email"
              placeholder="you@dealership.lk"
              error={errors.email?.message}
              {...register('email')}
            />

            <FormField
              label="Password *"
              type="password"
              autoComplete="new-password"
              error={errors.password?.message}
              {...register('password')}
            />

            <FormField
              label="Confirm Password *"
              type="password"
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />
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
                  {values.contactNumber ? ` · ${values.countryCode}${values.contactNumber}` : ''}
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{values.email || '—'}</dd>
              </div>
              <div>
                <dt>{values.dealerType === 'business' ? 'Registration certificate' : 'NIC'}</dt>
                <dd>
                  {values.dealerType === 'business'
                    ? documentName || '—'
                    : values.nicNumber || '—'}
                </dd>
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
            <Button type="button" variant="ghost" onClick={back}>
              ← Back
            </Button>
          )}

          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next} disabled={documentUploading}>
              Continue →
            </Button>
          ) : (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Create Dealer Account'}
            </Button>
          )}
        </div>
      </form>

      <p className="wizard-page__foot">
        Already have an account? <Link to="/dealer/login">Sign in</Link>
      </p>
    </div>
  )
}
