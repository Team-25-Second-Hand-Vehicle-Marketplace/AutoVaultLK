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
 *
 * `fuel_type`, `transmission`, `color`, `engine_capacity_cc`, `owners_count`
 * and `location_district` were widened from optional to required per the
 * updated SRS Appendix A: a listing missing any of these was judged too thin
 * for a buyer to evaluate, so a dealer file predating this column set is
 * rejected at the file gate rather than silently loading incomplete rows.
 */
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
] as const;

/**
 * Every column the pipeline reads as a field or a spec.
 *
 * A column outside this set is not an error — dealers export from their own
 * DMS and routinely carry fields we have no schema for. Those are appended to
 * the listing's description by the enrich stage rather than dropped, so they
 * stay readable and searchable without adding an unqueryable key to specs.
 */
export const KNOWN_COLUMNS = [
  ...REQUIRED_COLUMNS,
  // Not in REQUIRED_COLUMNS: an absent/unrecognised value leaves
  // Vehicle.vehicleType at its schema default ('CAR') via deriveVehicleType's
  // dictionary fallback (parse-normalize.stage.ts) rather than failing the
  // row — the SRS/SAD Appendix A table lists this as a required relational
  // column, but making it a hard CSV requirement would reject every dealer
  // file that predates this column for no benefit over the existing default.
  'vehicle_type',
  'registration_number',
  // fuel_type, transmission, color, engine_capacity_cc, owners_count and
  // location_district already arrive via the REQUIRED_COLUMNS spread above —
  // repeating them here would duplicate the column in every downloadable
  // template and in TEMPLATE_HEADER, which is exactly the header a dealer's
  // upload gets checked against.
  'body_type',
  'condition',
  'location_city',
  'chassis_number',
  'description',
  'is_negotiable',
  'registration_year',
  // Spec columns. These land in specs jsonb via the enrich stage, and each has
  // a matching entry in marketplace-service's KNOWN_SPEC_KEYS — without one the
  // value would be unqueryable.
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
  // Category-gated columns (SRS Appendix B.2) — read into specs only when
  // the row's vehicle_type matches the category each one describes (BIKE,
  // VAN/BUS, TRUCK/LORRY/PICKUP). See enrich.stage.ts's CAR_SUV/BIKE/
  // VAN_BUS/TRUCK tables.
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
] as const;

export type KnownColumn = (typeof KNOWN_COLUMNS)[number];

/**
 * Header aliases, folded through normalizeHeader. Dealers hand-edit these files
 * in Excel, so `Make`, `MAKE` and `Manufacturer` all turn up for the same
 * column. Accepting them here costs nothing; rejecting the file costs the
 * dealer a support ticket.
 */
const HEADER_ALIASES: Record<string, KnownColumn> = {
  type: 'vehicle_type',
  category: 'vehicle_type',
  vehicle_category: 'vehicle_type',
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

/**
 * The header row of the downloadable dealer template (§B5).
 *
 * Every KNOWN_COLUMNS entry, in the same order — the template is a complete
 * reference of what the pipeline accepts, not just the minimum to pass
 * validateFile. Only REQUIRED_COLUMNS + registration_number are mandatory;
 * everything else may be left blank, but showing dealers the full set means
 * they don't have to guess whether e.g. "sunroof" is something this pipeline
 * understands.
 */
export const TEMPLATE_HEADER: readonly string[] = [...KNOWN_COLUMNS];
