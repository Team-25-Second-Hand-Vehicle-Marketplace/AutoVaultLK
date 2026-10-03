import type { UploadFileFormat } from './ingestion.types'

/**
 * What differs between the two upload formats, in one place so the file picker,
 * the validation message, the template download and the instructions cannot
 * disagree about what "JSON" means.
 */
export const UPLOAD_FORMATS: Record<
  UploadFileFormat,
  {
    label: string
    extension: string
    /** The file input's `accept`, so the picker filters to the right type. */
    accept: string
    mime: string
    templateFileName: string
  }
> = {
  csv: {
    label: 'CSV',
    extension: '.csv',
    accept: '.csv,text/csv',
    mime: 'text/csv;charset=utf-8',
    templateFileName: 'autovault-inventory-template.csv',
  },
  json: {
    label: 'JSON',
    extension: '.json',
    accept: '.json,application/json',
    mime: 'application/json;charset=utf-8',
    templateFileName: 'autovault-inventory-template.json',
  },
}

export const TEMPLATE_HEADER = [
  'make',
  'model',
  'year',
  'price',
  'mileage',
  'fuel_type',
  'transmission',
  'color',
  'engine_capacity_cc',
  'owners_count',
  'location_district',
  'condition',
  'vehicle_type',
  'registration_number',
  'body_type',
  'location_city',
  'chassis_number',
  'description',
  'is_negotiable',
  'registration_year',
  'seats',
  'doors',
  'airbags',
  'load_capacity_kg',
  'drive_type',
  'sunroof',
  'full_option',
  'alloy_wheels',
  'reverse_camera',
  'leather_seats',
  'power_steering',
  'air_conditioning',
  'stroke_type',
  'cooling_system',
  'start_type',
  'abs_equipped',
  'seating_capacity',
  'roof_type',
  'wheelbase',
  'door_configuration',
  'payload_capacity_kg',
  'axle_count',
  'cargo_bed_type',
] as const

/** Everything else is optional; these are what validateFile insists on. */
export const REQUIRED_COLUMNS = [
  'make',
  'model',
  'year',
  'price',
  'mileage',
  'fuel_type',
  'transmission',
  'color',
  'engine_capacity_cc',
  'owners_count',
  'location_district',
  'condition',
  'vehicle_type',
] as const

export function isRequired(column: string): boolean {
  return (REQUIRED_COLUMNS as readonly string[]).includes(column)
}

/**
 * What each column accepts, for the on-page reference.
 *
 * The parser is deliberately forgiving - it strips currency prefixes and unit
 * suffixes, expands two-digit years, and folds ~35 header aliases - so these
 * describe intent rather than a strict format.
 */
export const COLUMN_HELP: Record<string, string> = {
  vehicle_type:
    'Car, Bike, Van, Truck, SUV, Bus, Three Wheeler, Lorry, Pickup, Tractor or Heavy Machinery. If a cell is blank we work it out from the make and model where we can (a Hilux is a pickup); a row where we cannot is rejected. Columns that do not apply to the type, such as a sunroof on a Bike, are ignored and flagged on the listing for your review.',
  registration_number:
    'Plate, e.g. CAB-1234. Leave blank for unregistered imports - but images are matched on it.',
  make: 'Manufacturer, e.g. Toyota. Misspellings are corrected where possible - see "Known makes & models" below to check spelling before uploading.',
  model: 'Model, e.g. Vitz. Matched within the make - see "Known makes & models" below.',
  year: 'Manufacture year, 1980 onwards. Two-digit years are expanded.',
  price: 'Asking price in LKR. "Rs. 3,500,000" and "3.5M" both work.',
  mileage: 'Odometer reading. "45,000 km" works.',
  fuel_type: 'Petrol, Diesel, Hybrid, Electric or CNG.',
  transmission: 'Manual, Automatic, CVT or Semi-automatic.',
  body_type: 'Sedan, Hatchback, SUV, Wagon, Coupe, Convertible, Pickup, Minivan…',
  condition:
    'One of: New, Used, or Reconditioned (also accepts "Brand new", "Recon", "Second hand"). A value outside these three is treated as Used - write one of the three plainly rather than a grade like "Excellent" or "Like new".',
  engine_capacity_cc: 'Engine size in cc, e.g. 1500.',
  color: 'Exterior color as a short plain name, e.g. White, Silver, Black, Pearl White. Free text - stick to a single common color name per vehicle so search and filtering stay useful.',
  owners_count: 'Number of previous owners.',
  location_city: 'City the vehicle is listed from, e.g. Colombo.',
  location_district: 'District, e.g. Colombo.',
  chassis_number: 'Chassis/VIN number.',
  description: 'Free-text notes. Anything in a column we don’t recognise is appended here too.',
  is_negotiable: 'true/false - whether the price is negotiable.',
  registration_year: 'Year the vehicle was first registered, if different from the manufacture year.',
  seats: 'Number of seats, e.g. 5.',
  doors: 'Number of doors, e.g. 4.',
  airbags: 'Number of airbags.',
  load_capacity_kg: 'Cargo capacity in kg (lorries/trucks).',
  drive_type: 'FWD, RWD, AWD or 4WD.',
  sunroof: 'true/false.',
  full_option: 'true/false - fully equipped.',
  alloy_wheels: 'true/false.',
  reverse_camera: 'true/false.',
  leather_seats: 'true/false.',
  power_steering: 'true/false.',
  air_conditioning: 'true/false.',
  stroke_type: '2-Stroke or 4-Stroke (bikes only).',
  cooling_system: 'Air or Liquid (bikes only).',
  start_type: 'Electric or Kick (bikes only).',
  abs_equipped: 'true/false (bikes only).',
  seating_capacity: 'Number of seats (vans/buses).',
  roof_type: 'High Roof or Standard (vans/buses).',
  wheelbase: 'Short, Medium or Long (vans/buses).',
  door_configuration: 'Sliding, Hinged, or both (vans/buses).',
  payload_capacity_kg: 'Cargo capacity in kg (trucks/lorries).',
  axle_count: 'Number of axles (trucks/lorries).',
  cargo_bed_type: 'Flatbed, Box, Tipper, Refrigerated or Other (trucks/lorries).',
}
