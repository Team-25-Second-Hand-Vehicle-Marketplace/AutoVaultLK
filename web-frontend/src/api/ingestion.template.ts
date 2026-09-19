/**
 * The dealer CSV columns, mirroring ingestion-service's
 * `src/workers/etl-worker/pipeline/parse/csv-contract.ts`.
 *
 * Kept as a copy rather than an import because the two services build
 * independently and the frontend has no path into ingestion-service's source.
 * If that file's TEMPLATE_HEADER or REQUIRED_COLUMNS change, change these too —
 * a template that no longer matches the parser hands dealers a file that fails
 * validation, which is worse than offering no template at all.
 */
export const TEMPLATE_HEADER = [
  'registration_number',
  'make',
  'model',
  'year',
  'price',
  'mileage',
  'fuel_type',
  'transmission',
  'body_type',
] as const

/** Everything else is optional; these five are what validateFile insists on. */
export const REQUIRED_COLUMNS = ['make', 'model', 'year', 'price', 'mileage'] as const

export function isRequired(column: string): boolean {
  return (REQUIRED_COLUMNS as readonly string[]).includes(column)
}

/**
 * What each column accepts, for the on-page reference.
 *
 * The parser is deliberately forgiving — it strips currency prefixes and unit
 * suffixes, expands two-digit years, and folds ~35 header aliases — so these
 * describe intent rather than a strict format.
 */
export const COLUMN_HELP: Record<string, string> = {
  registration_number:
    'Plate, e.g. CAB-1234. Leave blank for unregistered imports — but images are matched on it.',
  make: 'Manufacturer, e.g. Toyota. Misspellings are corrected where possible.',
  model: 'Model, e.g. Vitz. Matched within the make.',
  year: 'Manufacture year, 1980 onwards. Two-digit years are expanded.',
  price: 'Asking price in LKR. "Rs. 3,500,000" and "3.5M" both work.',
  mileage: 'Odometer reading. "45,000 km" works.',
  fuel_type: 'Petrol, Diesel, Hybrid, Electric or CNG.',
  transmission: 'Manual, Automatic, CVT or Semi-automatic.',
  body_type: 'Sedan, Hatchback, SUV, Wagon, Coupe, Convertible, Pickup, Minivan…',
}
