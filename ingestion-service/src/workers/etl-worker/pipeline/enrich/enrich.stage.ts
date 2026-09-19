import type {
  EnrichedRow,
  StageContext,
  StageResult,
  StageRunner,
  ValidatedRow,
} from '../types';
import { coerceInteger, coerceText } from '../normalize/coerce';

/**
 * Body types, matching marketplace-service/src/modules/search/constants/
 * known-spec-keys.constants.ts and the BODY_TYPES list in
 * database/src/seeds/vehicle-dictionaries.seed.ts.
 *
 * A value outside this set is invisible to the search facet that reads
 * specs.body_type, so it is dropped rather than stored — a spec key nothing
 * can filter on is worse than an absent one, because it looks like data.
 */
const BODY_TYPES = [
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
] as const;

/** Int spec keys and their bounds, from the same constants file. */
const INT_SPECS: Record<string, { column: string; min: number; max: number }> = {
  seats: { column: 'seats', min: 2, max: 60 },
  doors: { column: 'doors', min: 2, max: 6 },
  airbags: { column: 'airbags', min: 0, max: 12 },
  load_capacity_kg: { column: 'load_capacity_kg', min: 500, max: 20_000 },
};

const DRIVE_TYPES = ['FWD', 'RWD', 'AWD', '4WD'] as const;

/**
 * Boolean spec keys, and the header spellings dealers use for them.
 *
 * Every target key must exist in marketplace-service's KNOWN_SPEC_KEYS or the
 * value is unqueryable: filter-query.builder.ts rejects any key absent from
 * that table, so an unknown key is weight on every row that still looks like
 * data to anyone reading it.
 *
 * The aliases matter as much as the keys. A dealer writes "full option",
 * "fulloption" or "full_option" for the same thing, and the header has already
 * been folded to snake_case by csv-contract.ts before it reaches here.
 */
const BOOL_SPECS: Record<string, string> = {
  sunroof: 'sunroof',
  moonroof: 'sunroof',
  full_option: 'full_option',
  fulloption: 'full_option',
  fully_loaded: 'full_option',
  alloy_wheels: 'alloy_wheels',
  alloys: 'alloy_wheels',
  alloy: 'alloy_wheels',
  reverse_camera: 'reverse_camera',
  reversing_camera: 'reverse_camera',
  backup_camera: 'reverse_camera',
  rear_camera: 'reverse_camera',
  leather_seats: 'leather_seats',
  leather: 'leather_seats',
  power_steering: 'power_steering',
  ps: 'power_steering',
  air_conditioning: 'air_conditioning',
  ac: 'air_conditioning',
  aircon: 'air_conditioning',
  air_con: 'air_conditioning',
};

/**
 * Columns the pipeline consumes as vehicle fields rather than specs. Listed so
 * carryUnmappedColumns can tell "already used" from "extra".
 */
const CONSUMED_COLUMNS = new Set([
  'make',
  'model',
  'year',
  'price',
  'mileage',
  'registration_number',
  'registration_year',
  'fuel_type',
  'transmission',
  'body_type',
  'condition',
  'vehicle_type',
  'engine_capacity_cc',
  'color',
  'owners_count',
  'location_city',
  'location_district',
  'chassis_number',
  'description',
  'is_negotiable',
  'drive_type',
  ...Object.keys(INT_SPECS),
  ...Object.keys(BOOL_SPECS),
]);

/**
 * Cap on what unmapped columns may add to a description. A dealer export can
 * carry dozens of internal columns; appending all of them would bury whatever
 * the dealer actually wrote and dominate the embedding's input.
 */
const MAX_CARRIED_COLUMNS = 8;
const MAX_CARRIED_VALUE_LENGTH = 60;

/** marketplace.vehicles.condition defaults to USED; stated here rather than relied on. */
export const DEFAULT_CONDITION = 'USED';

/**
 * Fills in what the dealer did not supply and builds the `specs` jsonb.
 *
 * Runs after validateRows, so every row here is loadable and nothing this
 * stage does can make one invalid. It only adds.
 *
 * **`specs.body_type` must be set before embed runs.** buildSearchText reads
 * it (shared/normalize-embed/search-text.ts) — a bulk row without it produces
 * a shorter search text than the equivalent manual listing, and a different
 * text embeds to a different vector. That is FR-22.1 drift arriving through
 * the side door, so body type is resolved here and not left to Load.
 *
 * Unknown spec keys are never written to `specs`. That column is queried by
 * search facets against KNOWN_SPEC_KEYS, so an arbitrary dealer column stored
 * there is unqueryable weight on every row that still looks like data to
 * anyone reading the table.
 *
 * They are not discarded either. A dealer writing "Warranty: 2 years" or
 * "Service records: full" is describing the vehicle, and that is worth keeping
 * — so unmapped columns are appended to `description`, which is human-readable
 * on the listing and reaches the embedding through buildSearchText. Text is
 * the right home for information we cannot filter on.
 */
export const enrichStage: StageRunner<ValidatedRow[], StageResult<EnrichedRow>> = {
  stage: 'ENRICH',

  async run(ctx: StageContext, rows: ValidatedRow[]): Promise<StageResult<EnrichedRow>> {
    return {
      rows: rows.map((row) => enrichRow(ctx, row)),
      rejections: [],
    };
  },
};

function enrichRow(ctx: StageContext, row: ValidatedRow): EnrichedRow {
  const normalized = { ...row.normalized };

  // parseNormalize deliberately leaves condition absent when unrecognised so
  // the default lives in exactly one place — here.
  if (!normalized.condition) normalized.condition = DEFAULT_CONDITION;
  if (normalized.isNegotiable === undefined) normalized.isNegotiable = false;

  const specs = buildSpecs(ctx, row);
  if (Object.keys(specs).length > 0) normalized.specs = specs;

  const description = carryUnmappedColumns(row, normalized.description ?? null);
  if (description) normalized.description = description;

  return { ...row, normalized };
}

function buildSpecs(ctx: StageContext, row: ValidatedRow): Record<string, unknown> {
  const specs: Record<string, unknown> = { ...(row.normalized.specs ?? {}) };

  const bodyType = resolveBodyType(ctx, row.raw['body_type']);
  if (bodyType) specs.body_type = bodyType;

  for (const [column, spec] of Object.entries(INT_SPECS)) {
    const value = coerceInteger(row.raw[column]);
    // Out-of-range is dropped rather than clamped: 200 seats is a typo, and
    // clamping it to 60 would invent a plausible-looking fact.
    if (value !== null && value >= spec.min && value <= spec.max) {
      specs[spec.column] = value;
    }
  }

  const driveType = coerceText(row.raw['drive_type'])?.toUpperCase().replace(/[\s-]/g, '');
  if (driveType && (DRIVE_TYPES as readonly string[]).includes(driveType)) {
    specs.drive_type = driveType;
  }

  for (const [column, key] of Object.entries(BOOL_SPECS)) {
    const value = coerceBooleanSpec(row.raw[column]);
    // First column wins: "alloys" and "alloy_wheels" in the same file map to
    // one key, and a later blank must not overwrite an earlier true.
    if (value !== null && !(key in specs)) specs[key] = value;
  }

  return specs;
}

/**
 * Appends columns the pipeline has no field for to the description.
 *
 * A dealer's export carries whatever their own system tracks. Most of it is
 * noise, but "Warranty: 2 years" or "Extras: body kit, spoiler" is real
 * information a buyer would search for, and dropping it silently loses the
 * only place it existed.
 *
 * Rendered as "Key: value" so the text reads naturally in a listing and gives
 * the embedding a term to latch onto. Capped, because a dealer export with
 * forty internal columns would otherwise bury whatever they actually wrote.
 */
function carryUnmappedColumns(row: ValidatedRow, description: string | null): string | null {
  const extras: string[] = [];

  for (const [column, raw] of Object.entries(row.raw)) {
    if (CONSUMED_COLUMNS.has(column)) continue;
    if (extras.length >= MAX_CARRIED_COLUMNS) break;

    const value = coerceText(raw);
    if (!value) continue;

    // A column already quoted verbatim in the dealer's own description would
    // read as a duplicate.
    if (description && description.toLowerCase().includes(value.toLowerCase())) continue;

    extras.push(`${humanize(column)}: ${truncate(value)}`);
  }

  if (extras.length === 0) return description;

  const suffix = `${extras.join('. ')}.`;
  return description ? `${description} ${suffix}` : suffix;
}

/** `service_records` -> `Service records`. */
function humanize(column: string): string {
  const words = column.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function truncate(value: string): string {
  return value.length > MAX_CARRIED_VALUE_LENGTH
    ? `${value.slice(0, MAX_CARRIED_VALUE_LENGTH - 1)}…`
    : value;
}

/**
 * Resolves body type through the BODY_TYPE dictionary first, so the seed's
 * aliases apply — "saloon" is SEDAN and "jeep" is SUV in Sri Lankan usage, and
 * both are already in the seed. Falls back to a direct match on the canonical
 * list so the stage still works against a snapshot with no BODY_TYPE rows.
 */
function resolveBodyType(ctx: StageContext, raw: string | undefined): string | null {
  const text = coerceText(raw);
  if (!text) return null;

  const hit = ctx.dictionary.resolve('BODY_TYPE', text);
  if (hit && (BODY_TYPES as readonly string[]).includes(hit.canonical)) {
    return hit.canonical;
  }

  const upper = text.toUpperCase().replace(/[\s-]/g, '');
  return (BODY_TYPES as readonly string[]).includes(upper) ? upper : null;
}

/** Local to specs: unlike the column-level coercion, absence means "omit the key". */
function coerceBooleanSpec(raw: string | undefined): boolean | null {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return null;
  if (['true', 'yes', 'y', '1'].includes(text)) return true;
  if (['false', 'no', 'n', '0'].includes(text)) return false;
  return null;
}
