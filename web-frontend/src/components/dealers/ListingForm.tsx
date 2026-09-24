import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  CONDITIONS,
  FUEL_TYPES,
  LISTABLE_VEHICLE_TYPES,
  TRANSMISSION_TYPES,
  type CreateListingInput,
  type DealerListing,
} from '../../api/listings.types'
import { humanizeEnum } from '../search/vehicle-format'
import { Button } from '../ui/Button'
import { FormField } from '../ui/FormField'
import { SelectField } from '../ui/SelectField'

/**
 * The manual listing form, used for both create and edit.
 *
 * **This schema must track `CreateListingDto`.** Every rule below mirrors a
 * decorator in
 * `marketplace-service/src/modules/listings/dto/create-listing.dto.ts`; if the
 * two drift, the dealer gets a 400 with no field to attach it to. The option
 * lists come from `listings.types.ts`, which documents why the vehicle types
 * are narrower here than elsewhere in the app.
 */

const MIN_YEAR = 1980
const MAX_YEAR = new Date().getFullYear() + 1

/** An empty select or number input arrives as '' — treat it as absent. */
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))

const schema = z
  .object({
    make: z.string().trim().min(1, 'Make is required'),
    model: z.string().trim().min(1, 'Model is required'),

    manufactureYear: z.coerce
      .number({ message: 'Enter a year' })
      .int('Enter a whole year')
      .min(MIN_YEAR, `Year must be ${MIN_YEAR} or later`)
      .max(MAX_YEAR, `Year cannot be after ${MAX_YEAR}`),

    price: z.coerce
      .number({ message: 'Enter a price' })
      .positive('Price must be greater than zero'),

    mileage: z.coerce
      .number({ message: 'Enter the mileage' })
      .int('Enter a whole number')
      .min(0, 'Mileage cannot be negative'),

    // Required, but the select starts on an empty placeholder — so '' has to
    // be a *value* the schema rejects with a message, not a type error the
    // form cannot represent.
    fuelType: z
      .enum(FUEL_TYPES)
      .or(z.literal(''))
      .refine((v): v is (typeof FUEL_TYPES)[number] => v !== '', 'Select a fuel type'),
    transmissionType: z
      .enum(TRANSMISSION_TYPES)
      .or(z.literal(''))
      .refine(
        (v): v is (typeof TRANSMISSION_TYPES)[number] => v !== '',
        'Select a transmission',
      ),

    vehicleType: z.enum(LISTABLE_VEHICLE_TYPES).optional().or(z.literal('')),
    condition: z.enum(CONDITIONS).optional().or(z.literal('')),

    registrationYear: z
      .union([z.literal(''), z.coerce.number().int().min(MIN_YEAR).max(MAX_YEAR)])
      .optional(),

    description: optionalText,
  })
  .refine(
    (v) =>
      !v.registrationYear ||
      typeof v.registrationYear !== 'number' ||
      v.registrationYear >= v.manufactureYear,
    {
      // A vehicle cannot be registered before it was built; usually the two
      // fields have been swapped.
      message: 'Registration year cannot precede the manufacture year',
      path: ['registrationYear'],
    },
  )

/** After coercion — what the submit handler receives. */
export type ListingFormValues = z.infer<typeof schema>

/** Before coercion — what the inputs hold, where numbers are still strings. */
type ListingFormInput = z.input<typeof schema>

/** Keeps a stored value only if the form actually offers it. */
function pick<T extends string>(value: string | null, options: readonly T[]): T | '' {
  return value && (options as readonly string[]).includes(value) ? (value as T) : ''
}

/** Strips the empty strings the form uses for "not chosen". */
function toInput(values: ListingFormValues): CreateListingInput {
  return {
    make: values.make,
    model: values.model,
    manufactureYear: values.manufactureYear,
    price: values.price,
    mileage: values.mileage,
    fuelType: values.fuelType,
    transmissionType: values.transmissionType,
    ...(values.vehicleType ? { vehicleType: values.vehicleType } : {}),
    ...(values.condition ? { condition: values.condition } : {}),
    ...(typeof values.registrationYear === 'number'
      ? { registrationYear: values.registrationYear }
      : {}),
    ...(values.description ? { description: values.description } : {}),
  }
}

/** Mirrors marketplace-service's ImageUploadService limits exactly, so a
 * rejection happens client-side before a slow upload even starts. */
const MAX_IMAGE_FILES = 10
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

interface ListingFormProps {
  /** Present when editing; absent when creating. */
  listing?: DealerListing
  /**
   * `images` is empty when the dealer chose not to change photos — on edit,
   * that means "leave the existing set alone" (the page does not call the
   * upload endpoint at all in that case, since FR-58's replace-not-append
   * semantics would otherwise delete every photo the moment a dealer edited
   * the price without re-selecting files).
   */
  onSubmit: (input: CreateListingInput, images: File[]) => Promise<void>
  onCancel: () => void
  submitLabel: string
}

export function ListingForm({ listing, onSubmit, onCancel, submitLabel }: ListingFormProps) {
  const [images, setImages] = useState<File[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ListingFormInput, unknown, ListingFormValues>({
    resolver: zodResolver(schema),
    // Pre-filled from the list row itself: findByDealer returns the whole
    // entity, so editing needs no extra request.
    defaultValues: listing
      ? {
          make: listing.make,
          model: listing.model,
          manufactureYear: listing.manufactureYear,
          price: listing.price,
          mileage: listing.mileage,
          registrationYear: listing.registrationYear ?? '',
          // Stored as plain strings on the row. Anything outside the option
          // list falls back to empty, so a legacy value renders as "not
          // chosen" rather than as an invalid selection.
          fuelType: pick(listing.fuelType, FUEL_TYPES),
          transmissionType: pick(listing.transmissionType, TRANSMISSION_TYPES),
          vehicleType: pick(listing.vehicleType, LISTABLE_VEHICLE_TYPES),
          condition: pick(listing.condition, CONDITIONS),
          description: listing.description ?? '',
        }
      : undefined,
  })

  const onFilesSelected = (fileList: FileList | null) => {
    setImageError(null)
    const files = fileList ? Array.from(fileList) : []

    if (files.length === 0) {
      setImages([])
      return
    }
    if (files.length > MAX_IMAGE_FILES) {
      setImageError(`Choose at most ${MAX_IMAGE_FILES} photos`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setImages([])
      return
    }
    const rejected = files.find(
      (f) => !ACCEPTED_IMAGE_TYPES.includes(f.type) || f.size > MAX_IMAGE_SIZE_BYTES,
    )
    if (rejected) {
      setImageError(
        !ACCEPTED_IMAGE_TYPES.includes(rejected.type)
          ? `${rejected.name} is not a JPEG, PNG or WebP file`
          : `${rejected.name} is larger than ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB`,
      )
      if (fileInputRef.current) fileInputRef.current.value = ''
      setImages([])
      return
    }

    setImages(files)
  }

  return (
    <form
      className="listing-form"
      onSubmit={handleSubmit(async (values) => {
        await onSubmit(toInput(values), images)
      })}
      noValidate
    >
      <div className="listing-form__grid">
        <FormField
          label="Make"
          placeholder="Toyota"
          error={errors.make?.message}
          {...register('make')}
        />
        <FormField
          label="Model"
          placeholder="Vitz"
          error={errors.model?.message}
          {...register('model')}
        />

        <FormField
          label="Manufacture year"
          type="number"
          inputMode="numeric"
          placeholder="2015"
          error={errors.manufactureYear?.message}
          {...register('manufactureYear')}
        />
        <FormField
          label="Registration year (optional)"
          type="number"
          inputMode="numeric"
          error={errors.registrationYear?.message}
          {...register('registrationYear')}
        />

        <FormField
          label="Price (LKR)"
          type="number"
          inputMode="numeric"
          placeholder="3500000"
          error={errors.price?.message}
          {...register('price')}
        />
        <FormField
          label="Mileage (km)"
          type="number"
          inputMode="numeric"
          placeholder="45000"
          error={errors.mileage?.message}
          {...register('mileage')}
        />

        <SelectField
          label="Fuel type"
          options={FUEL_TYPES}
          placeholder="Select a fuel type"
          format={humanizeEnum}
          error={errors.fuelType?.message}
          {...register('fuelType')}
        />
        <SelectField
          label="Transmission"
          options={TRANSMISSION_TYPES}
          placeholder="Select a transmission"
          format={humanizeEnum}
          error={errors.transmissionType?.message}
          {...register('transmissionType')}
        />

        <SelectField
          label="Vehicle type (optional)"
          options={LISTABLE_VEHICLE_TYPES}
          placeholder="Not specified"
          format={humanizeEnum}
          error={errors.vehicleType?.message}
          {...register('vehicleType')}
        />
        <SelectField
          label="Condition (optional)"
          options={CONDITIONS}
          placeholder="Not specified"
          format={humanizeEnum}
          error={errors.condition?.message}
          {...register('condition')}
        />
      </div>

      <label className="form-field">
        <span>Description (optional)</span>
        <textarea rows={4} placeholder="Service history, extras, condition notes…" {...register('description')} />
      </label>

      <label className="form-field">
        <span>{listing ? 'Replace photos (optional)' : 'Photos (optional)'}</span>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          multiple
          onChange={(e) => onFilesSelected(e.target.files)}
        />
        <span className="upload-field__hint">
          {listing
            ? 'Choosing new photos replaces the ones already on this listing. Leave empty to keep them.'
            : `Up to ${MAX_IMAGE_FILES} JPEG, PNG or WebP photos, ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB each. The first photo becomes the main image.`}
        </span>
        {images.length > 0 && (
          <span className="upload-field__hint">
            {images.length} photo{images.length === 1 ? '' : 's'} selected
          </span>
        )}
        {imageError && <span className="form-error">{imageError}</span>}
      </label>

      <div className="dealer-page__actions">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
