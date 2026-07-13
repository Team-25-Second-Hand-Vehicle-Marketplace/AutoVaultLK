import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  BODY_TYPES,
  CARGO_BED_TYPES,
  CONDITIONS,
  COOLING_SYSTEMS,
  DOOR_CONFIGURATIONS,
  DRIVE_TYPES,
  FUEL_TYPES,
  LISTABLE_VEHICLE_TYPES,
  ROOF_TYPES,
  START_TYPES,
  STROKE_TYPES,
  TRANSMISSION_TYPES,
  WHEELBASES,
  type CreateListingInput,
  type DealerListing,
  type DealerListingImage,
} from '../../api/listings.types'
import { humanizeEnum } from '../search/vehicle-format'
import { Button } from '../ui/Button'
import { FormField } from '../ui/FormField'
import { SelectField } from '../ui/SelectField'
import {
  BIKE_TYPES,
  CAR_SUV_TYPES,
  DISTRICTS,
  EQUIPMENT,
  MANAGED_SPEC_KEYS,
  TRUCK_TYPES,
  VAN_BUS_TYPES,
  buildSpecs,
  equipmentAvailable,
  specFlag,
  specText,
} from './listing-form.specs'


const MIN_YEAR = 1980
const MAX_YEAR = new Date().getFullYear() + 1

/** An empty select or number input arrives as '' - treat it as absent. */
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))

/** Blank is "not given"; anything else must be a whole number in range. */
const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce
      .number({ message: 'Enter a number' })
      .int('Enter a whole number')
      .min(min, `Must be ${min} or more`)
      .max(max, `Must be ${max} or fewer`)
      .optional(),
  )

/** A select that starts on a "Not specified" placeholder. */
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().or(z.literal(''))

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

    // Required, but the select starts on an empty placeholder - so '' has to
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

    // The CSV's other required columns (REQUIRED_COLUMNS) - same limits as
    // CreateListingDto.
    color: z.string().trim().min(1, 'Color is required').max(50, 'At most 50 characters'),
    engineCapacityCc: z.coerce
      .number({ message: 'Enter the engine size in cc' })
      .int('Enter a whole number')
      .min(50, 'Engine size must be 50 cc or more')
      .max(20_000, 'Engine size must be 20,000 cc or less'),
    ownersCount: z.coerce
      .number({ message: 'Enter the number of owners' })
      .int('Enter a whole number')
      .min(0, 'Cannot be negative')
      .max(20, 'At most 20'),
    locationDistrict: z
      .string()
      .trim()
      .min(1, 'District is required')
      .max(100, 'At most 100 characters'),

    // Required, and it decides which of the fields below apply, so the select
    // starts empty and the dependent fields stay locked until it is chosen.
    vehicleType: z
      .enum(LISTABLE_VEHICLE_TYPES)
      .or(z.literal(''))
      .refine(
        (v): v is (typeof LISTABLE_VEHICLE_TYPES)[number] => v !== '',
        'Select a vehicle type',
      ),
    condition: z.enum(CONDITIONS).optional().or(z.literal('')),

    registrationYear: z
      .union([z.literal(''), z.coerce.number().int().min(MIN_YEAR).max(MAX_YEAR)])
      .optional(),

    locationCity: optionalText,
    registrationNumber: optionalText,
    chassisNumber: optionalText,
    isNegotiable: z.boolean().optional(),
    description: optionalText,

    // Specs. Ranges and vocabularies match ingestion-service's enrich stage.
    bodyType: optionalEnum(BODY_TYPES),
    seats: optionalInt(2, 60),
    doors: optionalInt(2, 6),
    airbags: optionalInt(0, 12),
    driveType: optionalEnum(DRIVE_TYPES),
    strokeType: optionalEnum(STROKE_TYPES),
    coolingSystem: optionalEnum(COOLING_SYSTEMS),
    startType: optionalEnum(START_TYPES),
    absEquipped: z.boolean().optional(),
    seatingCapacity: optionalInt(2, 60),
    roofType: optionalEnum(ROOF_TYPES),
    wheelbase: optionalEnum(WHEELBASES),
    doorConfiguration: optionalEnum(DOOR_CONFIGURATIONS),
    loadCapacityKg: optionalInt(500, 20_000),
    payloadCapacityKg: optionalInt(100, 50_000),
    axleCount: optionalInt(2, 6),
    cargoBedType: optionalEnum(CARGO_BED_TYPES),
    sunroof: z.boolean().optional(),
    fullOption: z.boolean().optional(),
    alloyWheels: z.boolean().optional(),
    reverseCamera: z.boolean().optional(),
    leatherSeats: z.boolean().optional(),
    powerSteering: z.boolean().optional(),
    airConditioning: z.boolean().optional(),
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

/** After coercion - what the submit handler receives. */
export type ListingFormValues = z.infer<typeof schema>

/** Before coercion - what the inputs hold, where numbers are still strings. */
type ListingFormInput = z.input<typeof schema>

/** Keeps a stored value only if the form actually offers it. */
function pick<T extends string>(value: string | null, options: readonly T[]): T | '' {
  return value && (options as readonly string[]).includes(value) ? (value as T) : ''
}

/** Strips the empty strings the form uses for "not chosen". */
function toInput(
  values: ListingFormValues,
  extraSpecs: Record<string, unknown>,
): CreateListingInput {
  return {
    make: values.make,
    model: values.model,
    manufactureYear: values.manufactureYear,
    price: values.price,
    mileage: values.mileage,
    fuelType: values.fuelType,
    transmissionType: values.transmissionType,
    color: values.color,
    engineCapacityCc: values.engineCapacityCc,
    ownersCount: values.ownersCount,
    locationDistrict: values.locationDistrict,
    vehicleType: values.vehicleType,
    ...(values.condition ? { condition: values.condition } : {}),
    ...(typeof values.registrationYear === 'number'
      ? { registrationYear: values.registrationYear }
      : {}),
    ...(values.locationCity ? { locationCity: values.locationCity } : {}),
    ...(values.registrationNumber ? { registrationNumber: values.registrationNumber } : {}),
    ...(values.chassisNumber ? { chassisNumber: values.chassisNumber } : {}),
    isNegotiable: values.isNegotiable ?? false,
    ...(values.description ? { description: values.description } : {}),
    // Always sent, even when empty, so an edit that clears every spec clears
    // them rather than leaving the old ones in place.
    specs: buildSpecs(values, extraSpecs),
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
   * `images` is empty when the dealer chose not to change photos - on edit,
   * that means "leave the existing set alone" (the page does not call the
   * upload endpoint at all in that case, since FR-58's replace-not-append
   * semantics would otherwise delete every photo the moment a dealer edited
   * the price without re-selecting files).
   */
  onSubmit: (input: CreateListingInput, images: File[]) => Promise<void>
  /**
   * Present only in edit mode. Removes one existing photo immediately
   * (its own request, not deferred to Save) - replaceImages requires
   * resending every file to keep, but the browser has no File object for a
   * photo it only knows as a stored URL, so a per-photo delete needs its own
   * call. Rejecting leaves the thumbnail in place.
   */
  onDeleteImage?: (imageId: string) => Promise<void>
  onCancel: () => void
  submitLabel: string
}

export function ListingForm({
  listing,
  onSubmit,
  onDeleteImage,
  onCancel,
  submitLabel,
}: ListingFormProps) {
  const [images, setImages] = useState<File[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [existingImages, setExistingImages] = useState<DealerListingImage[]>(
    listing?.images ?? [],
  )
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Spec keys on an edited listing that this form does not manage (carried
  // over from a bulk upload); sent back unchanged so an edit cannot drop them.
  const extraSpecs = Object.fromEntries(
    Object.entries(listing?.specs ?? {}).filter(([key]) => !MANAGED_SPEC_KEYS.has(key)),
  )

  const {
    register,
    handleSubmit,
    control,
    setValue,
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
          color: listing.color ?? '',
          engineCapacityCc: listing.engineCapacityCc ?? '',
          ownersCount: listing.ownersCount ?? '',
          locationDistrict: listing.locationDistrict ?? '',
          locationCity: listing.locationCity ?? '',
          registrationNumber: listing.registrationNumber ?? '',
          chassisNumber: listing.chassisNumber ?? '',
          isNegotiable: listing.isNegotiable ?? false,
          description: listing.description ?? '',
          bodyType: pick(specText(listing.specs, 'body_type') || null, BODY_TYPES),
          seats: specText(listing.specs, 'seats'),
          doors: specText(listing.specs, 'doors'),
          airbags: specText(listing.specs, 'airbags'),
          driveType: pick(specText(listing.specs, 'drive_type') || null, DRIVE_TYPES),
          strokeType: pick(specText(listing.specs, 'stroke_type') || null, STROKE_TYPES),
          coolingSystem: pick(specText(listing.specs, 'cooling_system') || null, COOLING_SYSTEMS),
          startType: pick(specText(listing.specs, 'start_type') || null, START_TYPES),
          absEquipped: specFlag(listing.specs, 'abs_equipped'),
          seatingCapacity: specText(listing.specs, 'seating_capacity'),
          roofType: pick(specText(listing.specs, 'roof_type') || null, ROOF_TYPES),
          wheelbase: pick(specText(listing.specs, 'wheelbase') || null, WHEELBASES),
          doorConfiguration: pick(
            specText(listing.specs, 'door_configuration') || null,
            DOOR_CONFIGURATIONS,
          ),
          loadCapacityKg: specText(listing.specs, 'load_capacity_kg'),
          payloadCapacityKg: specText(listing.specs, 'payload_capacity_kg'),
          axleCount: specText(listing.specs, 'axle_count'),
          cargoBedType: pick(specText(listing.specs, 'cargo_bed_type') || null, CARGO_BED_TYPES),
          sunroof: specFlag(listing.specs, 'sunroof'),
          fullOption: specFlag(listing.specs, 'full_option'),
          alloyWheels: specFlag(listing.specs, 'alloy_wheels'),
          reverseCamera: specFlag(listing.specs, 'reverse_camera'),
          leatherSeats: specFlag(listing.specs, 'leather_seats'),
          powerSteering: specFlag(listing.specs, 'power_steering'),
          airConditioning: specFlag(listing.specs, 'air_conditioning'),
        }
      : undefined,
  })

  // Nothing is assumed for a blank type: the fields that depend on it stay
  // locked until the dealer chooses one.
  const selectedType = useWatch({ control, name: 'vehicleType' }) || ''
  const typeChosen = selectedType !== ''

  // A value typed under one vehicle type must not linger, invisibly, once that
  // type's fields are hidden: a stale out-of-range number would block the
  // submit with an error on a field the dealer can no longer see.
  useEffect(() => {
    if (!selectedType) return
    const clear = (fields: (keyof ListingFormInput)[], empty: '' | false) =>
      fields.forEach((field) => setValue(field, empty as never))

    if (!CAR_SUV_TYPES.includes(selectedType)) clear(['seats', 'doors', 'airbags', 'driveType'], '')
    if (!BIKE_TYPES.includes(selectedType)) {
      clear(['strokeType', 'coolingSystem', 'startType'], '')
      clear(['absEquipped'], false)
    }
    if (!VAN_BUS_TYPES.includes(selectedType)) {
      clear(['seatingCapacity', 'roofType', 'wheelbase', 'doorConfiguration'], '')
    }
    if (!TRUCK_TYPES.includes(selectedType)) {
      clear(['loadCapacityKg', 'payloadCapacityKg', 'axleCount', 'cargoBedType'], '')
    }
    for (const { field, key } of EQUIPMENT) {
      if (!equipmentAvailable(selectedType, key)) setValue(field, false)
    }
  }, [selectedType, setValue])

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

  const onRemoveExisting = async (imageId: string) => {
    if (!onDeleteImage) return
    setDeletingImageId(imageId)
    try {
      await onDeleteImage(imageId)
      setExistingImages((prev) => prev.filter((img) => img.id !== imageId))
    } catch {
      // The caller already surfaces a toast for the failure; the thumbnail
      // simply stays put since nothing changed.
    } finally {
      setDeletingImageId(null)
    }
  }

  return (
    <form
      className="listing-form"
      onSubmit={handleSubmit(async (values) => {
        await onSubmit(toInput(values, extraSpecs), images)
      })}
      noValidate
    >
      <div className="listing-form__grid">
        <SelectField
          label="Vehicle type"
          options={LISTABLE_VEHICLE_TYPES}
          placeholder="Select a vehicle type"
          format={humanizeEnum}
          error={errors.vehicleType?.message}
          {...register('vehicleType')}
        />
        <p className="listing-form__hint">
          Choose this first. It decides which of the other details apply.
        </p>

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
          label="Condition (optional)"
          options={CONDITIONS}
          placeholder="Not specified"
          format={humanizeEnum}
          error={errors.condition?.message}
          {...register('condition')}
        />

        <FormField
          label="Color"
          placeholder="Pearl White"
          error={errors.color?.message}
          {...register('color')}
        />
        <FormField
          label="Engine capacity (cc)"
          type="number"
          inputMode="numeric"
          placeholder="1500"
          error={errors.engineCapacityCc?.message}
          {...register('engineCapacityCc')}
        />
        <FormField
          label="Previous owners"
          type="number"
          inputMode="numeric"
          placeholder="1"
          error={errors.ownersCount?.message}
          {...register('ownersCount')}
        />

        <FormField
          label="District"
          list="listing-form-districts"
          placeholder="Colombo"
          error={errors.locationDistrict?.message}
          {...register('locationDistrict')}
        />
        <FormField
          label="City (optional)"
          placeholder="Nugegoda"
          error={errors.locationCity?.message}
          {...register('locationCity')}
        />
        <SelectField
          label="Body type (optional)"
          options={BODY_TYPES}
          placeholder={typeChosen ? 'Not specified' : 'Choose a vehicle type first'}
          disabled={!typeChosen}
          format={humanizeEnum}
          error={errors.bodyType?.message}
          {...register('bodyType')}
        />

        <FormField
          label="Registration number (optional)"
          placeholder="CAB-1234"
          error={errors.registrationNumber?.message}
          {...register('registrationNumber')}
        />
        <FormField
          label="Chassis number (optional)"
          error={errors.chassisNumber?.message}
          {...register('chassisNumber')}
        />
      </div>
      <datalist id="listing-form-districts">
        {DISTRICTS.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>

      <label className="toggle-filter">
        <input type="checkbox" {...register('isNegotiable')} />
        Price is negotiable
      </label>

      {CAR_SUV_TYPES.includes(selectedType) && (
        <fieldset className="listing-form__section">
          <legend>Car &amp; SUV details</legend>
          <div className="listing-form__grid">
            <FormField
              label="Seats (optional)"
              type="number"
              inputMode="numeric"
              error={errors.seats?.message}
              {...register('seats')}
            />
            <FormField
              label="Doors (optional)"
              type="number"
              inputMode="numeric"
              error={errors.doors?.message}
              {...register('doors')}
            />
            <FormField
              label="Airbags (optional)"
              type="number"
              inputMode="numeric"
              error={errors.airbags?.message}
              {...register('airbags')}
            />
            <SelectField
              label="Drive type (optional)"
              options={DRIVE_TYPES}
              placeholder="Not specified"
              error={errors.driveType?.message}
              {...register('driveType')}
            />
          </div>
        </fieldset>
      )}

      {BIKE_TYPES.includes(selectedType) && (
        <fieldset className="listing-form__section">
          <legend>Bike details</legend>
          <div className="listing-form__grid">
            <SelectField
              label="Stroke type (optional)"
              options={STROKE_TYPES}
              placeholder="Not specified"
              format={humanizeEnum}
              error={errors.strokeType?.message}
              {...register('strokeType')}
            />
            <SelectField
              label="Cooling system (optional)"
              options={COOLING_SYSTEMS}
              placeholder="Not specified"
              format={humanizeEnum}
              error={errors.coolingSystem?.message}
              {...register('coolingSystem')}
            />
            <SelectField
              label="Start type (optional)"
              options={START_TYPES}
              placeholder="Not specified"
              format={humanizeEnum}
              error={errors.startType?.message}
              {...register('startType')}
            />
          </div>
          <label className="toggle-filter">
            <input type="checkbox" {...register('absEquipped')} />
            ABS equipped
          </label>
        </fieldset>
      )}

      {VAN_BUS_TYPES.includes(selectedType) && (
        <fieldset className="listing-form__section">
          <legend>Van &amp; bus details</legend>
          <div className="listing-form__grid">
            <FormField
              label="Seating capacity (optional)"
              type="number"
              inputMode="numeric"
              error={errors.seatingCapacity?.message}
              {...register('seatingCapacity')}
            />
            <SelectField
              label="Roof type (optional)"
              options={ROOF_TYPES}
              placeholder="Not specified"
              format={humanizeEnum}
              error={errors.roofType?.message}
              {...register('roofType')}
            />
            <SelectField
              label="Wheelbase (optional)"
              options={WHEELBASES}
              placeholder="Not specified"
              format={humanizeEnum}
              error={errors.wheelbase?.message}
              {...register('wheelbase')}
            />
            <SelectField
              label="Door configuration (optional)"
              options={DOOR_CONFIGURATIONS}
              placeholder="Not specified"
              format={humanizeEnum}
              error={errors.doorConfiguration?.message}
              {...register('doorConfiguration')}
            />
          </div>
        </fieldset>
      )}

      {TRUCK_TYPES.includes(selectedType) && (
        <fieldset className="listing-form__section">
          <legend>Truck, lorry &amp; pickup details</legend>
          <div className="listing-form__grid">
            <FormField
              label="Load capacity, kg (optional)"
              type="number"
              inputMode="numeric"
              error={errors.loadCapacityKg?.message}
              {...register('loadCapacityKg')}
            />
            <FormField
              label="Payload capacity, kg (optional)"
              type="number"
              inputMode="numeric"
              error={errors.payloadCapacityKg?.message}
              {...register('payloadCapacityKg')}
            />
            <FormField
              label="Axle count (optional)"
              type="number"
              inputMode="numeric"
              error={errors.axleCount?.message}
              {...register('axleCount')}
            />
            <SelectField
              label="Cargo bed type (optional)"
              options={CARGO_BED_TYPES}
              placeholder="Not specified"
              format={humanizeEnum}
              error={errors.cargoBedType?.message}
              {...register('cargoBedType')}
            />
          </div>
        </fieldset>
      )}

      {!typeChosen && (
        <p className="listing-form__locked" role="status">
          Choose a vehicle type to unlock the details and equipment that apply to it.
        </p>
      )}

      <fieldset className="listing-form__section" disabled={!typeChosen}>
        <legend>Equipment</legend>
        <div className="listing-form__checks">
          {EQUIPMENT.map(({ field, key, label }) => {
            const available = equipmentAvailable(selectedType, key)
            return (
              <label
                key={field}
                className="toggle-filter"
                title={
                  typeChosen && !available
                    ? `Not applicable to a ${humanizeEnum(selectedType).toLowerCase()}`
                    : undefined
                }
              >
                <input type="checkbox" disabled={typeChosen && !available} {...register(field)} />
                {label}
              </label>
            )
          })}
        </div>
      </fieldset>

      <label className="form-field">
        <span>Description (optional)</span>
        <textarea rows={4} placeholder="Service history, extras, condition notes…" {...register('description')} />
      </label>

      {listing && existingImages.length > 0 && (
        <div className="form-field">
          <span>Current photos</span>
          <div className="listing-form__existing-images">
            {existingImages.map((image) => (
              <figure key={image.id} className="listing-form__existing-image">
                {image.thumbnailUrl ? (
                  <img src={image.thumbnailUrl} alt="" loading="lazy" />
                ) : (
                  <div className="listing-form__existing-image-placeholder" aria-hidden="true" />
                )}
                {image.isPrimary && (
                  <figcaption className="listing-form__existing-image-badge">Primary</figcaption>
                )}
                <button
                  type="button"
                  className="listing-form__existing-image-remove"
                  disabled={deletingImageId === image.id}
                  onClick={() => void onRemoveExisting(image.id)}
                  aria-label="Remove this photo"
                >
                  {deletingImageId === image.id ? 'Removing…' : 'Remove'}
                </button>
              </figure>
            ))}
          </div>
          <span className="upload-field__hint">
            Removing a photo here takes effect immediately, even without saving the rest of this
            form.
          </span>
        </div>
      )}

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
