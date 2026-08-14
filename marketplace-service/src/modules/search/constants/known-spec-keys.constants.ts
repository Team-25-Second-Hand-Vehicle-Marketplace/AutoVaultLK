/**
 * The single source of truth for what can live inside vehicles.specs and be
 * filtered on. plan-b §risk-3: this constant must be imported — never
 * re-declared — by the search DTO, the query builder, the future Groq
 * prompt builder, and ETL's enrichment stage. Four independent places have
 * to agree on this shape; only this file is allowed to define it.
 *
 * Keys here came from what the Phase 0 seed data actually populated, not
 * from the design doc's illustrative list — body_type/seats/doors/
 * drive_type/sunroof/airbags cover cars and SUVs; engine_class and
 * load_capacity_kg were added because they showed up seeding bikes and
 * lorries and have no relational column to live in instead.
 *
 * Enum values intentionally exclude SCOOTER/MOTORBIKE as vehicle_type
 * values — those are body_type entries here instead (see Decision on
 * vehicle types: enum values are for top-level categories buyers filter
 * by; anything finer belongs in specs).
 */

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
  // Bikes: displacement class, e.g. "150cc". Stored as a free enum-ish
  // string in the seed rather than a parsed integer — kept as enum here
  // to match, since "150cc" vs 150 is an ingestion normalization problem,
  // not a search one.
  engine_class: {
    type: 'enum',
    values: ['100cc', '125cc', '150cc', '155cc', '160cc', '200cc', '250cc+'],
  },
  // Lorries/trucks: cargo capacity in kilograms.
  load_capacity_kg: { type: 'int', min: 500, max: 20000 },
} as const satisfies Record<string, SpecKeyDefinition>;

export type KnownSpecKey = keyof typeof KNOWN_SPEC_KEYS;

export const KNOWN_SPEC_KEY_NAMES = Object.keys(KNOWN_SPEC_KEYS) as KnownSpecKey[];
