import type { TEMPLATE_HEADER } from '../../api/ingestion.template'

/**
 * Which form field carries each dealer-CSV column. Typed against
 * `TEMPLATE_HEADER`, so adding a column to the template without a field here is
 * a compile error - the manual form and the bulk template cannot silently drift
 * apart. `listing-form.contract.test.ts` checks the same at run time.
 */
export const CSV_COLUMN_TO_FIELD: Record<(typeof TEMPLATE_HEADER)[number], string> = {
  make: 'make',
  model: 'model',
  year: 'manufactureYear',
  price: 'price',
  mileage: 'mileage',
  fuel_type: 'fuelType',
  transmission: 'transmissionType',
  color: 'color',
  engine_capacity_cc: 'engineCapacityCc',
  owners_count: 'ownersCount',
  location_district: 'locationDistrict',
  vehicle_type: 'vehicleType',
  registration_number: 'registrationNumber',
  body_type: 'bodyType',
  condition: 'condition',
  location_city: 'locationCity',
  chassis_number: 'chassisNumber',
  description: 'description',
  is_negotiable: 'isNegotiable',
  registration_year: 'registrationYear',
  seats: 'seats',
  doors: 'doors',
  airbags: 'airbags',
  load_capacity_kg: 'loadCapacityKg',
  drive_type: 'driveType',
  sunroof: 'sunroof',
  full_option: 'fullOption',
  alloy_wheels: 'alloyWheels',
  reverse_camera: 'reverseCamera',
  leather_seats: 'leatherSeats',
  power_steering: 'powerSteering',
  air_conditioning: 'airConditioning',
  stroke_type: 'strokeType',
  cooling_system: 'coolingSystem',
  start_type: 'startType',
  abs_equipped: 'absEquipped',
  seating_capacity: 'seatingCapacity',
  roof_type: 'roofType',
  wheelbase: 'wheelbase',
  door_configuration: 'doorConfiguration',
  payload_capacity_kg: 'payloadCapacityKg',
  axle_count: 'axleCount',
  cargo_bed_type: 'cargoBedType',
}

/** Sri Lanka's 25 districts - suggestions only; the field stays free text like the CSV's. */
export const DISTRICTS = [
  'Ampara', 'Anuradhapura', 'Badulla', 'Batticaloa', 'Colombo', 'Galle', 'Gampaha',
  'Hambantota', 'Jaffna', 'Kalutara', 'Kandy', 'Kegalle', 'Kilinochchi', 'Kurunegala',
  'Mannar', 'Matale', 'Matara', 'Monaragala', 'Mullaitivu', 'Nuwara Eliya',
  'Polonnaruwa', 'Puttalam', 'Ratnapura', 'Trincomalee', 'Vavuniya',
]

// vehicle_type groups, mirroring the enrich stage's category gating: a spec
// column is only stored for the category it describes.
export const CAR_SUV_TYPES = ['CAR', 'SUV']
export const BIKE_TYPES = ['BIKE']
export const VAN_BUS_TYPES = ['VAN', 'BUS']
export const TRUCK_TYPES = ['TRUCK', 'LORRY', 'PICKUP']

/** Equipment that applies to every vehicle type. */
export const EQUIPMENT = [
  { field: 'sunroof', key: 'sunroof', label: 'Sunroof' },
  { field: 'fullOption', key: 'full_option', label: 'Full option' },
  { field: 'alloyWheels', key: 'alloy_wheels', label: 'Alloy wheels' },
  { field: 'reverseCamera', key: 'reverse_camera', label: 'Reverse camera' },
  { field: 'leatherSeats', key: 'leather_seats', label: 'Leather seats' },
  { field: 'powerSteering', key: 'power_steering', label: 'Power steering' },
  { field: 'airConditioning', key: 'air_conditioning', label: 'Air conditioning' },
] as const

/** Every `specs` key the form owns. Anything else on an edited listing is preserved untouched. */
export const MANAGED_SPEC_KEYS = new Set<string>([
  'body_type', 'seats', 'doors', 'airbags', 'drive_type',
  'stroke_type', 'cooling_system', 'start_type', 'abs_equipped',
  'seating_capacity', 'roof_type', 'wheelbase', 'door_configuration',
  'load_capacity_kg', 'payload_capacity_kg', 'axle_count', 'cargo_bed_type',
  ...EQUIPMENT.map((e) => e.key),
])

/** The spec-bearing slice of the form's values. */
export interface SpecValues {
  vehicleType?: string
  bodyType?: string
  seats?: number
  doors?: number
  airbags?: number
  driveType?: string
  strokeType?: string
  coolingSystem?: string
  startType?: string
  absEquipped?: boolean
  seatingCapacity?: number
  roofType?: string
  wheelbase?: string
  doorConfiguration?: string
  loadCapacityKg?: number
  payloadCapacityKg?: number
  axleCount?: number
  cargoBedType?: string
  sunroof?: boolean
  fullOption?: boolean
  alloyWheels?: boolean
  reverseCamera?: boolean
  leatherSeats?: boolean
  powerSteering?: boolean
  airConditioning?: boolean
}

/**
 * The `specs` object for a submit. Mirrors the enrich stage: a category's
 * columns are stored only for that category (a bike's stroke type on a car is
 * dropped), the equipment flags apply to every type, and an unticked flag is
 * left out rather than stored as false - the same as a blank CSV cell.
 *
 * `extras` are keys on an edited listing that the form does not own (a bulk
 * upload's carried-over DMS columns); they pass through so an edit never
 * silently deletes them.
 */
export function buildSpecs(
  values: SpecValues,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const type = values.vehicleType || 'CAR'
  const specs: Record<string, unknown> = { ...extras }
  const put = (key: string, value: unknown) => {
    if (value !== undefined && value !== '' && value !== false) specs[key] = value
  }

  put('body_type', values.bodyType)

  if (CAR_SUV_TYPES.includes(type)) {
    put('seats', values.seats)
    put('doors', values.doors)
    put('airbags', values.airbags)
    put('drive_type', values.driveType)
  }
  if (BIKE_TYPES.includes(type)) {
    put('stroke_type', values.strokeType)
    put('cooling_system', values.coolingSystem)
    put('start_type', values.startType)
    put('abs_equipped', values.absEquipped)
  }
  if (VAN_BUS_TYPES.includes(type)) {
    put('seating_capacity', values.seatingCapacity)
    put('roof_type', values.roofType)
    put('wheelbase', values.wheelbase)
    put('door_configuration', values.doorConfiguration)
  }
  if (TRUCK_TYPES.includes(type)) {
    put('load_capacity_kg', values.loadCapacityKg)
    put('payload_capacity_kg', values.payloadCapacityKg)
    put('axle_count', values.axleCount)
    put('cargo_bed_type', values.cargoBedType)
  }
  for (const { field, key } of EQUIPMENT) put(key, values[field])

  return specs
}

/** A listing's stored spec value as the string/number a form input holds. */
export function specText(specs: Record<string, unknown> | null, key: string): string {
  const value = specs?.[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export const specFlag = (specs: Record<string, unknown> | null, key: string): boolean =>
  specs?.[key] === true
