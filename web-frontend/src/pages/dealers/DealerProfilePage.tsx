import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { z } from 'zod'
import { updateMyDealerProfile } from '../../api/dealer.api'
import { toErrorMessage } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { useDealerProfile } from './useDealerProfile'

/** Matches auth-user-service's PHONE_REGEX exactly (E.164-ish, optional +). */
const PHONE_REGEX = /^\+?[1-9]\d{8,14}$/

const schema = z.object({
  companyName: z.string().trim().min(2, 'Company name is required'),
  // Business dealers only — see the conditional field below and the
  // superRefine, which is how the requirement is actually enforced (an
  // individual dealer's businessRegistrationNumber is never sent to the
  // schema empty-checked, since the field is never rendered for them).
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
})

type FormValues = z.infer<typeof schema>

/**
 * Self-service edit for the details a dealer gave at registration. Deliberately
 * does not include verification documents (a bigger, separate flow — re-upload
 * would need its own re-verification step) or dealerType/email (not part of
 * UpdateDealerProfileDto; the backend fixes dealer type at registration).
 */
export function DealerProfilePage() {
  const profile = useDealerProfile()
  const dealer = profile.data

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      companyName: '',
      businessRegistrationNumber: '',
      businessAddress: '',
      city: '',
      contactNumber: '',
    },
  })

  // The form loads before the profile does (same context, one tick behind),
  // so its fields start empty and are filled in once the fetch resolves.
  useEffect(() => {
    if (!dealer) return
    reset({
      companyName: dealer.companyName,
      businessRegistrationNumber: dealer.businessRegistrationNumber ?? '',
      businessAddress: dealer.businessAddress,
      city: dealer.city,
      contactNumber: dealer.contactNumber ?? '',
    })
  }, [dealer, reset])

  if (profile.loading) {
    return (
      <div className="dealer-page">
        <p className="dealer-muted" role="status">
          Loading your details…
        </p>
      </div>
    )
  }

  if (profile.error || !dealer) {
    return (
      <div className="dealer-page">
        <ErrorBanner message={profile.error ?? 'No data'} />
      </div>
    )
  }

  const onSubmit = handleSubmit(async (values) => {
    if (dealer.dealerType === 'business' && !values.businessRegistrationNumber) {
      toast.error('Business registration number is required for a business dealer.')
      return
    }

    try {
      await updateMyDealerProfile(dealer.userId, {
        companyName: values.companyName.trim(),
        // Individual dealers never had this field editable here (it's hidden
        // below), so it's left out of the request rather than sent empty —
        // a PATCH only touches the fields it's given.
        ...(dealer.dealerType === 'business'
          ? { businessRegistrationNumber: values.businessRegistrationNumber.trim() }
          : {}),
        businessAddress: values.businessAddress.trim(),
        city: values.city.trim(),
        contactNumber: values.contactNumber?.trim() || undefined,
      })
      toast.success('Your details have been updated.')
      profile.reload()
    } catch (error) {
      toast.error(toErrorMessage(error, 'Could not update your details.'))
    }
  })

  return (
    <div className="dealer-page">
      <header className="dealer-page__header">
        <h1>Business details</h1>
        <p>Keep the information buyers and our team see up to date.</p>
      </header>

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

        <div className="dealer-page__actions">
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
