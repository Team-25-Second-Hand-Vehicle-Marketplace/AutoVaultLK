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
  // filter-query.builder.ts rejects any key absent from this table. Applies
  // to any vehicle_type — a van or truck can have a sunroof too, so these are
  // not gated by category the way the keys below are (ingestion-service's
  // enrich.stage.ts CAR_SUV/BIKE/VAN_BUS/TRUCK tables).
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

  // Category-specific attributes (SRS Appendix B.2). Each is only ever
  // written by enrich.stage.ts when the row's vehicle_type matches the
  // category it describes — a CAR row with an axle_count column does not get
  // this key, so a search facet offering "Axle count" never applies to a car.
  // CAR/SUV's own category keys (seats, doors, drive_type, sunroof, airbags,
  // body_type) are already declared above, shared with the general list.

  // BIKE
  stroke_type: { type: 'enum', values: ['2_STROKE', '4_STROKE'] },
  cooling_system: { type: 'enum', values: ['AIR', 'LIQUID'] },
  start_type: { type: 'enum', values: ['ELECTRIC', 'KICK'] },
  abs_equipped: { type: 'bool' },

  // VAN / BUS
  seating_capacity: { type: 'int', min: 2, max: 60 },
  roof_type: { type: 'enum', values: ['HIGH_ROOF', 'STANDARD'] },
  wheelbase: { type: 'enum', values: ['SHORT', 'MEDIUM', 'LONG'] },
  door_configuration: {
    type: 'enum',
    values: ['SLIDING', 'HINGED', 'SLIDING_AND_HINGED'],
  },

  // TRUCK
  payload_capacity_kg: { type: 'int', min: 100, max: 50000 },
  axle_count: { type: 'int', min: 2, max: 6 },
  cargo_bed_type: {
    type: 'enum',
    values: ['FLATBED', 'BOX', 'TIPPER', 'REFRIGERATED', 'OTHER'],
  },
} as const satisfies Record<string, SpecKeyDefinition>;

export type KnownSpecKey = keyof typeof KNOWN_SPEC_KEYS;

export const KNOWN_SPEC_KEY_NAMES = Object.keys(KNOWN_SPEC_KEYS) as KnownSpecKey[];
