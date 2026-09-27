import { z } from 'zod'

/** Sri Lankan NIC: old format (9 digits + V/X) or new format (12 digits) — matches the backend's NIC_REGEX. */
export const NIC_REGEX = /^(?:\d{9}[vVxX]|\d{12})$/

/** Small fixed set of dial codes — Sri Lanka first/default since this is a Sri Lankan marketplace. */
export const COUNTRY_CODES = [
  { code: '+94', label: '🇱🇰 +94 (Sri Lanka)' },
  { code: '+91', label: '🇮🇳 +91 (India)' },
  { code: '+1', label: '🇺🇸 +1 (US/Canada)' },
  { code: '+44', label: '🇬🇧 +44 (UK)' },
  { code: '+61', label: '🇦🇺 +61 (Australia)' },
] as const

export const dealerRegisterSchema = z
  .object({
    // Step 1 — company
    companyName: z.string().trim().min(2, 'Company name is required'),
    dealerType: z.enum(['individual', 'business']),
    // Mandatory for business dealers only. An individual seller has no business
    // to register (they are identified by NIC), so it is optional for them and
    // the backend stores an empty value. The 500 cap matches the DB column.
    businessRegistrationNumber: z.string().trim().max(500, 'Registration number is too long').optional(),
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
  .refine((v) => v.dealerType !== 'business' || (v.businessRegistrationNumber ?? '').length > 0, {
    message: 'Registration number is required for a business',
    path: ['businessRegistrationNumber'],
  })

export type FormValues = z.infer<typeof dealerRegisterSchema>
