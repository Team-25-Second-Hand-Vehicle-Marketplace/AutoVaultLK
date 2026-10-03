
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
] as const;

export const KNOWN_COLUMNS = [
  ...REQUIRED_COLUMNS,
  'registration_number',
  // fuel_type, transmission, color, engine_capacity_cc, owners_count,
  // location_district, condition and vehicle_type already arrive via the REQUIRED_COLUMNS spread above -
  // repeating them here would duplicate the column in every downloadable
  // template and in TEMPLATE_HEADER, which is exactly the header a dealer's
  // upload gets checked against.
  'body_type',
  'location_city',
  'chassis_number',
  'description',
  'is_negotiable',
  'registration_year',
  // Spec columns. These land in specs jsonb via the enrich stage, and each has
  // a matching entry in marketplace-service's KNOWN_SPEC_KEYS - without one the
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
  // Category-gated columns (SRS Appendix B.2) - read into specs only when
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

export function normalizeHeader(header: string): string {
  const key = header
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  return HEADER_ALIASES[key] ?? key;
}

export const TEMPLATE_HEADER: readonly string[] = [...KNOWN_COLUMNS];
