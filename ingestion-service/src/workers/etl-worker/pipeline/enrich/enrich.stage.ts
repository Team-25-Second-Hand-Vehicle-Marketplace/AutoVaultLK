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
 * Unknown spec keys are dropped, not passed through. `specs` is queried by
 * search facets against KNOWN_SPEC_KEYS; an arbitrary dealer column stored
 * there is unqueryable weight on every row, and looks like data to anyone
 * reading the table.
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

  const sunroof = coerceBooleanSpec(row.raw['sunroof']);
  if (sunroof !== null) specs.sunroof = sunroof;

  return specs;
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
