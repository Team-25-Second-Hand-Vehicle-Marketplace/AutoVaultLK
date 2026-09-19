export type SpecKeyType = 'enum' | 'int' | 'bool';

export type SpecKeyDefinition =
  | { type: 'enum'; values: readonly string[] }
  | { type: 'int'; min: number; max: number }
  | { type: 'bool' };

export const KNOWN_SPEC_KEYS = {
  body_type: {
    type: 'enum',
    values: [
      'SEDAN',
      'HATCHBACK',
      'SUV',
      'WAGON',
      'COUPE',
      'CONVERTIBLE',
      'PICKUP',
      'MINIVAN',
      'SCOOTER',
      'MOTORBIKE',
    ],
  },
  seats: { type: 'int', min: 2, max: 60 }, // 2 (coupe) .. 60 (bus)
  doors: { type: 'int', min: 2, max: 6 },
  drive_type: { type: 'enum', values: ['FWD', 'RWD', 'AWD', '4WD'] },
  sunroof: { type: 'bool' },
  airbags: { type: 'int', min: 0, max: 12 },

  engine_class: {
    type: 'enum',
    values: ['100cc', '125cc', '150cc', '155cc', '160cc', '200cc', '250cc+'],
  },
  // Lorries/trucks: cargo capacity in kilograms.
  load_capacity_kg: { type: 'int', min: 500, max: 20000 },

  // Equipment Sri Lankan dealers actually advertise. These arrive as columns
  // in bulk uploads ("full option", "alloy wheels") and as words in buyer
  // queries; declaring them here is what makes them filterable at all, since
  // filter-query.builder.ts rejects any key absent from this table.
  //
  // Anything a dealer supplies that is NOT listed here is appended to the
  // listing's description instead of being dropped — see
  // ingestion-service .../enrich.stage.ts. It stays searchable as text without
  // adding an unqueryable key to specs.
  full_option: { type: 'bool' },
  alloy_wheels: { type: 'bool' },
  reverse_camera: { type: 'bool' },
  leather_seats: { type: 'bool' },
  power_steering: { type: 'bool' },
  air_conditioning: { type: 'bool' },
} as const satisfies Record<string, SpecKeyDefinition>;

export type KnownSpecKey = keyof typeof KNOWN_SPEC_KEYS;

export const KNOWN_SPEC_KEY_NAMES = Object.keys(KNOWN_SPEC_KEYS) as KnownSpecKey[];
