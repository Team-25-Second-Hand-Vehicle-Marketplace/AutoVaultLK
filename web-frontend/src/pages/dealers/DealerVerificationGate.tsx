import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { z } from 'zod'
import { uploadVerificationDocument } from '../../api/auth.api'
import { resubmitMyDealerProfile } from '../../api/dealer.api'
import type { DealerProfile } from '../../api/dealer.types'
import { toErrorMessage } from '../../api/client'
import type { AsyncData } from '../../hooks/useAsyncData'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'

/** Mirrors auth-user-service's DocumentUploadService limits — same as DealerRegisterPage. */
const ACCEPTED_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png']
const MAX_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024

/** Matches auth-user-service's NIC_REGEX exactly. */
const NIC_REGEX = /^(?:\d{9}[vVxX]|\d{12})$/
/** Matches auth-user-service's PHONE_REGEX exactly (E.164-ish, optional +). */
const PHONE_REGEX = /^\+?[1-9]\d{8,14}$/

const schema = z.object({
  companyName: z.string().trim().min(2, 'Company name is required'),
  businessRegistrationNumber: z.string().trim(),
  businessAddress: z.string().trim().min(4, 'Business address is required'),
  city: z.string().trim().min(2, 'City is required'),
  contactNumber: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || PHONE_REGEX.test(v), {
      message: 'Enter a valid phone number, e.g. +94701234567',
    }),
  nicNumber: z.string().trim().optional(),
})

type FormValues = z.infer<typeof schema>

/**
 * The one screen a PENDING or REJECTED dealer gets — see RequireVerifiedDealer
 * and DealerLayout's empty nav for the rest of what keeps it that way.
 * DealerDashboardPage renders this instead of the dashboard whenever
 * `profile.data.verificationStatus !== 'VERIFIED'`.
 */
export function DealerVerificationGate({ profile }: { profile: AsyncData<DealerProfile> }) {
  const dealer = profile.data as DealerProfile

  if (dealer.verificationStatus === 'PENDING') {
    return (
      <div className="dealer-page">
        <header className="dealer-page__header">
          <h1>{dealer.companyName}</h1>
          <p>Your application is being reviewed.</p>
        </header>

        <div className="dealer-banner dealer-banner--pending">
          <strong>Verification pending</strong>
          <span>
            An administrator is reviewing your account. You&apos;ll be able to list vehicles
            once you&apos;re verified.
          </span>
        </div>
      </div>
    )
  }

  return <RejectedResubmitForm dealer={dealer} profile={profile} />
}

function RejectedResubmitForm({
  dealer,
  profile,
}: {
  dealer: DealerProfile
  profile: AsyncData<DealerProfile>
}) {
  const [documentKey, setDocumentKey] = useState<string | null>(null)
  const [documentName, setDocumentName] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [documentUploading, setDocumentUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      companyName: dealer.companyName,
      businessRegistrationNumber: dealer.businessRegistrationNumber ?? '',
      businessAddress: dealer.businessAddress,
      city: dealer.city,
      contactNumber: dealer.contactNumber ?? '',
      nicNumber: '',
    },
  })

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

  const onSubmit = handleSubmit(async (values) => {
    if (dealer.dealerType === 'business' && !values.businessRegistrationNumber) {
      toast.error('Business registration number is required for a business dealer.')
      return
    }
    if (dealer.dealerType === 'business' && !documentKey) {
      setDocumentError('Upload your business registration certificate to resubmit')
      return
    }
    if (dealer.dealerType === 'individual' && !NIC_REGEX.test(values.nicNumber ?? '')) {
      toast.error('Enter a valid NIC (9 digits + V/X, or 12 digits).')
      return
    }

    const verificationDocuments =
      dealer.dealerType === 'business'
        ? { businessRegistrationCertificate: documentKey ?? '' }
        : { nic: (values.nicNumber ?? '').trim() }

    try {
      await resubmitMyDealerProfile(dealer.userId, {
        companyName: values.companyName.trim(),
        ...(dealer.dealerType === 'business'
          ? { businessRegistrationNumber: values.businessRegistrationNumber.trim() }
          : {}),
        businessAddress: values.businessAddress.trim(),
        city: values.city.trim(),
        contactNumber: values.contactNumber?.trim() || undefined,
        verificationDocuments,
      })
      toast.success('Resubmitted — an administrator will take another look.')
      profile.reload()
    } catch (error) {
      toast.error(toErrorMessage(error, 'Could not resubmit your details.'))
    }
  })

  return (
    <div className="dealer-page">
      <header className="dealer-page__header">
        <h1>{dealer.companyName}</h1>
        <p>Fix the details below and resubmit for review.</p>
      </header>

      <div className="dealer-banner dealer-banner--rejected">
        <strong>Verification rejected</strong>
        <span>{dealer.rejectionReason ?? 'Contact support for details.'}</span>
      </div>

      <form className="dealer-form" onSubmit={onSubmit} noValidate>
        <FormField
          label="Company name"
          type="text"
          error={errors.companyName?.message}
          {...register('companyName')}
        />

        {dealer.dealerType === 'business' && (
          <FormField
            label="Business registration number"
            type="text"
            error={errors.businessRegistrationNumber?.message}
            {...register('businessRegistrationNumber')}
          />
        )}

        <FormField
          label="Business address"
          type="text"
          error={errors.businessAddress?.message}
          {...register('businessAddress')}
        />

        <FormField
          label="City"
          type="text"
          error={errors.city?.message}
          {...register('city')}
        />

        <FormField
          label="Contact number"
          type="tel"
          placeholder="+94701234567"
          error={errors.contactNumber?.message}
          {...register('contactNumber')}
        />

        {dealer.dealerType === 'individual' ? (
          <FormField
            label="NIC number"
            type="text"
            placeholder="e.g. 200012345678 or 991234567V"
            error={errors.nicNumber?.message}
            {...register('nicNumber')}
          />
        ) : (
          <div className="form-field">
            <span>Business registration certificate</span>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_DOCUMENT_TYPES.join(',')}
              onChange={(e) => onDocumentSelected(e.target.files)}
            />
            <span className="upload-field__hint">
              PDF, JPEG or PNG, up to {MAX_DOCUMENT_SIZE_BYTES / 1024 / 1024} MB.
            </span>
            {documentUploading && <span className="upload-field__hint">Uploading…</span>}
            {documentName && !documentUploading && (
              <span className="upload-field__hint">Uploaded: {documentName}</span>
            )}
            {documentError && <span className="form-error">{documentError}</span>}
          </div>
        )}

        <div className="dealer-page__actions">
          <Button type="submit" disabled={isSubmitting || documentUploading}>
            {isSubmitting ? 'Resubmitting…' : 'Resubmit for review'}
          </Button>
        </div>
      </form>
    </div>
  )
}
