/**
 * The dealer CSV contract — the single definition of what a bulk upload file
 * must look like.
 *
 * This is a shared boundary, not an implementation detail: validateFile checks
 * headers against it, splitChunks parses with it, and the downloadable template
 * on the dealer frontend (§B5) is generated from it. All three must agree, so
 * they read the same constants rather than restating the column list.
 *
 * The column names match src/tools/vehicle-generator/vehicle-generator.ts, so
 * generated fixtures are valid uploads by construction.
 */

/**
 * Columns a file must carry to be processable at all. Their absence is a file
 * defect, not a row defect — there is no per-row rejection that could describe
 * "this file has no price column", so validateFile fails the whole job.
 *
 * `registration_number` is deliberately NOT required: unregistered imports are
 * legitimate stock and arrive with the column blank. It is still declared in
 * KNOWN_COLUMNS because the image matcher (§B3) keys on it.
 */
export const REQUIRED_COLUMNS = ['make', 'model', 'year', 'price', 'mileage'] as const;

/**
 * Every column the pipeline reads. Anything outside this set is preserved in
 * rejected_records.raw_data for the dealer to inspect but is otherwise ignored
 * — an unknown column is not an error, because dealers export from their own
 * DMS and routinely carry extra fields we have no use for.
 */
export const KNOWN_COLUMNS = [
  ...REQUIRED_COLUMNS,
  'registration_number',
  'fuel_type',
  'transmission',
  'body_type',
  'condition',
  'engine_capacity_cc',
  'color',
  'owners_count',
  'location_city',
  'location_district',
  'chassis_number',
  'description',
  'is_negotiable',
  'registration_year',
] as const;

export type KnownColumn = (typeof KNOWN_COLUMNS)[number];

/**
 * Header aliases, folded through normalizeHeader. Dealers hand-edit these files
 * in Excel, so `Make`, `MAKE` and `Manufacturer` all turn up for the same
 * column. Accepting them here costs nothing; rejecting the file costs the
 * dealer a support ticket.
 */
const HEADER_ALIASES: Record<string, KnownColumn> = {
  manufacturer: 'make',
  brand: 'make',
  variant: 'model',
  manufacture_year: 'year',
  year_of_manufacture: 'year',
  model_year: 'year',
  yom: 'year',
  asking_price: 'price',
  amount: 'price',
  odometer: 'mileage',
  km: 'mileage',
  kilometers: 'mileage',
  mileage_km: 'mileage',
  reg_no: 'registration_number',
  registration: 'registration_number',
  vehicle_number: 'registration_number',
  number_plate: 'registration_number',
  fuel: 'fuel_type',
  gear: 'transmission',
  gearbox: 'transmission',
  transmission_type: 'transmission',
  body: 'body_type',
  engine_capacity: 'engine_capacity_cc',
  engine: 'engine_capacity_cc',
  cc: 'engine_capacity_cc',
  owners: 'owners_count',
  previous_owners: 'owners_count',
  city: 'location_city',
  district: 'location_district',
  location: 'location_district',
  chassis: 'chassis_number',
  notes: 'description',
  remarks: 'description',
  negotiable: 'is_negotiable',
};

/**
 * Folds a raw header cell to its canonical column name.
 *
 * Excel writes a UTF-8 BOM at the start of the first cell, which would make
 * `﻿make` miss an exact comparison against `make` — a failure that is
 * invisible in every editor and reads as "the file has no make column". Strip
 * it here, once, rather than debugging it per dealer.
 */
export function normalizeHeader(header: string): string {
  const key = header
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  return HEADER_ALIASES[key] ?? key;
}

/** The header row of the downloadable dealer template (§B5). */
export const TEMPLATE_HEADER: readonly string[] = [
  'registration_number',
  'make',
  'model',
  'year',
  'price',
  'mileage',
  'fuel_type',
  'transmission',
  'body_type',
];
