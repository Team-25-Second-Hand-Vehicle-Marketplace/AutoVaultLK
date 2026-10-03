import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { z } from 'zod'
import { updateMyDealerProfile } from '../../api/dealer.api'
import { updateMyName } from '../../api/users.api'
import { toErrorMessage } from '../../api/client'
import { useAuth } from '../../auth/useAuth'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { useDealerProfile } from './useDealerProfile'

/** Matches auth-user-service's PERSON_NAME_MIN/MAX (2–255) and PHONE_REGEX exactly. */
const PHONE_REGEX = /^\+?[1-9]\d{8,14}$/

const schema = z.object({
  // The dealer's own name (User.name - who to contact), distinct from
  // companyName (DealerProfile - what to call the business). Two different
  // resources, two different PATCH calls on submit; see onSubmit below.
  name: z.string().trim().min(2, 'Contact name is required').max(255),
  companyName: z.string().trim().min(2, 'Company name is required'),
  // Business dealers only - see the conditional field below and the
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

export function DealerProfilePage() {
  const { user, updateUser } = useAuth()
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
      name: '',
      companyName: '',
      businessRegistrationNumber: '',
      businessAddress: '',
      city: '',
      contactNumber: '',
    },
  })

  // The form loads before the profile (and user) does, so its fields start
  // empty and are filled in once both have resolved.
  useEffect(() => {
    if (!dealer) return
    reset({
      name: user?.name ?? '',
      companyName: dealer.companyName,
      businessRegistrationNumber: dealer.businessRegistrationNumber ?? '',
      businessAddress: dealer.businessAddress,
      city: dealer.city,
      contactNumber: dealer.contactNumber ?? '',
    })
  }, [dealer, user, reset])

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
      // Two different resources - User.name and the DealerProfile fields -
      // so two PATCH calls. Name first: if it fails, nothing else is saved
      // either, which is simpler to reason about than a partial save.
      const updatedUser = await updateMyName(dealer.userId, values.name.trim())
      updateUser(updatedUser)

      await updateMyDealerProfile(dealer.userId, {
        companyName: values.companyName.trim(),
        // Individual dealers never had this field editable here (it's hidden
        // below), so it's left out of the request rather than sent empty -
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
          label="Your name"
          type="text"
          error={errors.name?.message}
          {...register('name')}
        />

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
