import type {
  EnrichedRow,
  NormalizationProvenance,
  StageContext,
  StageResult,
  StageRunner,
  ValidatedRow,
} from '../types';
import { coerceInteger, coerceText } from '../normalize/coerce';
import { coerceVehicleType } from '../normalize/enum-vocabulary';

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

const CAR_SUV_TYPES = new Set(['CAR', 'SUV']);
const BIKE_TYPES = new Set(['BIKE']);
const VAN_BUS_TYPES = new Set(['VAN', 'BUS']);
const TRUCK_TYPES = new Set(['TRUCK', 'LORRY', 'PICKUP']);

const STROKE_TYPES = ['2_STROKE', '4_STROKE'] as const;
const COOLING_SYSTEMS = ['AIR', 'LIQUID'] as const;
const START_TYPES = ['ELECTRIC', 'KICK'] as const;

const ROOF_TYPES = ['HIGH_ROOF', 'STANDARD'] as const;
const WHEELBASES = ['SHORT', 'MEDIUM', 'LONG'] as const;
const DOOR_CONFIGURATIONS = ['SLIDING', 'HINGED', 'SLIDING_AND_HINGED'] as const;

const CARGO_BED_TYPES = ['FLATBED', 'BOX', 'TIPPER', 'REFRIGERATED', 'OTHER'] as const;

/** CAR/SUV int specs. Doors/seats/airbags describe a car or SUV's cabin, not a bike, van or truck's. */
const CAR_SUV_INT_SPECS: Record<string, { column: string; min: number; max: number }> = {
  seats: { column: 'seats', min: 2, max: 60 },
  doors: { column: 'doors', min: 2, max: 6 },
  airbags: { column: 'airbags', min: 0, max: 12 },
};

const VAN_BUS_INT_SPECS: Record<string, { column: string; min: number; max: number }> = {
  seating_capacity: { column: 'seating_capacity', min: 2, max: 60 },
};

/** Trucks/lorries/pickups: cargo capacity, from the pre-existing load_capacity_kg key. */
const TRUCK_INT_SPECS: Record<string, { column: string; min: number; max: number }> = {
  load_capacity_kg: { column: 'load_capacity_kg', min: 500, max: 20_000 },
  payload_capacity_kg: { column: 'payload_capacity_kg', min: 100, max: 50_000 },
  axle_count: { column: 'axle_count', min: 2, max: 6 },
};

const DRIVE_TYPES = ['FWD', 'RWD', 'AWD', '4WD'] as const;

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

/** BIKE-only boolean spec. Gated the same way the category int/enum tables are. */
const BIKE_BOOL_SPECS: Record<string, string> = {
  abs_equipped: 'abs_equipped',
  abs: 'abs_equipped',
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
  'stroke_type',
  'cooling_system',
  'start_type',
  'roof_type',
  'wheelbase',
  'door_configuration',
  'cargo_bed_type',
  ...Object.keys(CAR_SUV_INT_SPECS),
  ...Object.keys(VAN_BUS_INT_SPECS),
  ...Object.keys(TRUCK_INT_SPECS),
  ...Object.keys(BOOL_SPECS),
  ...Object.keys(BIKE_BOOL_SPECS),
]);

/**
 * Cap on what unmapped columns may add to a description. A dealer export can
 * carry dozens of internal columns; appending all of them would bury whatever
 * the dealer actually wrote and dominate the embedding's input.
 */
const MAX_CARRIED_COLUMNS = 8;
const MAX_CARRIED_VALUE_LENGTH = 60;

const MAX_DYNAMIC_SPEC_KEYS = 20;
const MAX_DYNAMIC_SPEC_VALUE_LENGTH = 200;

/**
 * Columns that only describe one category of vehicle. A value in one of these
 * on a row of a different type (stroke type on a car, axle count on a bike) is
 * ignored, never stored. Mirrors the gating in buildSpecs below.
 */
const CATEGORY_COLUMNS: { types: Set<string>; columns: string[] }[] = [
  { types: CAR_SUV_TYPES, columns: [...Object.keys(CAR_SUV_INT_SPECS), 'drive_type'] },
  {
    types: BIKE_TYPES,
    columns: ['stroke_type', 'cooling_system', 'start_type', ...Object.keys(BIKE_BOOL_SPECS)],
  },
  {
    types: VAN_BUS_TYPES,
    columns: [...Object.keys(VAN_BUS_INT_SPECS), 'roof_type', 'wheelbase', 'door_configuration'],
  },
  { types: TRUCK_TYPES, columns: [...Object.keys(TRUCK_INT_SPECS), 'cargo_bed_type'] },
];

/**
 * Cabin comfort equipment makes no sense on these types (a sunroof on a motor
 * bike), so a "yes" there is ignored. Alloy wheels stay allowed: bikes and
 * three-wheelers have them. Van, truck, tractor and machinery rows keep every
 * equipment column, since a cab can have air conditioning or a sunroof.
 */
const NO_COMFORT_EQUIPMENT_TYPES = new Set(['BIKE', 'THREE_WHEELER']);
const COMFORT_EQUIPMENT_KEYS = new Set([
  'sunroof',
  'full_option',
  'reverse_camera',
  'leather_seats',
  'power_steering',
  'air_conditioning',
]);

/**
 * How little confidence an ignored-value note carries. Below the review UI's
 * low-confidence line (0.6), so the listing is flagged for a second look, and
 * low enough to sort it to the top of "lowest confidence first".
 */
const INAPPLICABLE_CONFIDENCE = 0.3;

/** Same idea for a vehicle type the dealer wrote that we could not read. */
const UNREADABLE_TYPE_CONFIDENCE = 0.4;
const MAX_NOTE_LENGTH = 500;

/** marketplace.vehicles.condition defaults to USED; stated here rather than relied on. */
export const DEFAULT_CONDITION = 'USED';

/**
 * marketplace.vehicles.review_reason (migration 30000). A short machine code
 * rather than a sentence, so the review UI can branch on it without parsing
 * text - see the migration's own comment for why this is a separate column
 * from `status`.
 */
export const REVIEW_REASON_NO_REGISTRATION_NUMBER = 'NO_REGISTRATION_NUMBER';

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
  // the default lives in exactly one place - here.
  if (!normalized.condition) normalized.condition = DEFAULT_CONDITION;
  if (normalized.isNegotiable === undefined) normalized.isNegotiable = false;

  // FR-35.2: a blank registration_number is not a defect (unregistered
  // imports are legitimate stock) but it means the images branch has no key
  // to match photos against, so the row needs a dealer's eyes before it can
  // go LIVE even after the rest of the listing looks fine.
  if (!normalized.registrationNumber) {
    normalized.needsManualReview = true;
    normalized.reviewReason = REVIEW_REASON_NO_REGISTRATION_NUMBER;
  }

  const specs = buildSpecs(ctx, row);
  if (Object.keys(specs).length > 0) normalized.specs = specs;

  const description = carryUnmappedColumns(row, normalized.description ?? null);
  if (description) normalized.description = description;

  // Values the dealer filled in that do not fit this vehicle type were left out
  // above. Say so on the listing, in the dealer's review queue, rather than let
  // them vanish: a bike marked "sunroof: yes" is almost always a slip in a
  // shared template, and the dealer is the one who can tell which side is wrong
  // (the value, or the vehicle type).
  const ignored = findInapplicableColumns(row);
  const typeNote = describeUnreadableType(row);
  if (ignored.length === 0 && !typeNote) return { ...row, normalized };

  const provenance: NormalizationProvenance = { ...(row.provenance ?? {}) };
  let confidence = row.confidence;

  if (typeNote) {
    provenance.vehicleType = {
      source: 'dictionary',
      confidence: UNREADABLE_TYPE_CONFIDENCE,
      reasoning: typeNote,
    };
    confidence = Math.min(confidence, UNREADABLE_TYPE_CONFIDENCE);
  }

  if (ignored.length > 0) {
    provenance.specs = {
      source: 'rule',
      confidence: INAPPLICABLE_CONFIDENCE,
      reasoning: describeIgnored(row.normalized.vehicleType, ignored),
    };
    confidence = Math.min(confidence, INAPPLICABLE_CONFIDENCE);
  }

  return { ...row, normalized, provenance, confidence };
}

/**
 * A vehicle_type cell the dealer filled in but we could not read ("Hoverboard",
 * a typo). parseNormalize falls back to the type implied by the make and model,
 * which is usually right, but doing it without a word would hide that the
 * dealer's own value was thrown away. Said on the listing instead, so the dealer
 * can confirm the type or fix it.
 */
function describeUnreadableType(row: ValidatedRow): string | null {
  const cell = coerceText(row.raw['vehicle_type']);
  if (!cell || coerceVehicleType(cell)) return null;

  const type = row.normalized.vehicleType.replace(/_/g, ' ').toLowerCase();
  return (
    `Vehicle type "${truncate(cell)}" was not recognised, so "${type}" was used, ` +
    'taken from the make and model. Check it is right, or correct the vehicle type.'
  );
}

/**
 * Columns with a real value on a row they do not apply to. Blank cells and a
 * plain "no" are not reported: a shared template leaves most columns empty, and
 * "sunroof: no" on a bike is true, not a mistake.
 */
function findInapplicableColumns(row: ValidatedRow): string[] {
  const vehicleType = row.normalized.vehicleType;
  const ignored: string[] = [];

  const hasValue = (column: string): boolean => {
    const value = coerceText(row.raw[column]);
    return value !== null && value !== undefined && coerceBooleanSpec(row.raw[column]) !== false;
  };

  for (const group of CATEGORY_COLUMNS) {
    if (group.types.has(vehicleType)) continue;
    for (const column of group.columns) {
      if (hasValue(column)) ignored.push(column);
    }
  }

  if (NO_COMFORT_EQUIPMENT_TYPES.has(vehicleType)) {
    for (const [column, key] of Object.entries(BOOL_SPECS)) {
      if (COMFORT_EQUIPMENT_KEYS.has(key) && coerceBooleanSpec(row.raw[column]) === true) {
        ignored.push(column);
      }
    }
  }

  return ignored;
}

function describeIgnored(vehicleType: string, columns: string[]): string {
  const labels = columns.map((c) => humanize(c).toLowerCase());
  const type = vehicleType.replace(/_/g, ' ').toLowerCase();
  const note =
    `Ignored for a ${type}: ${labels.join(', ')}. ` +
    `${labels.length === 1 ? 'It does' : 'They do'} not apply to this vehicle type. ` +
    'Edit the listing if it matters, or correct the vehicle type if that is the slip.';
  return note.length > MAX_NOTE_LENGTH ? `${note.slice(0, MAX_NOTE_LENGTH - 1)}…` : note;
}

function buildSpecs(ctx: StageContext, row: ValidatedRow): Record<string, unknown> {
  const specs: Record<string, unknown> = { ...(row.normalized.specs ?? {}) };
  const vehicleType = row.normalized.vehicleType;

  const bodyType = resolveBodyType(ctx, row.raw['body_type']);
  if (bodyType) specs.body_type = bodyType;

  // Category-gated int specs: a column only ever lands in `specs` when the
  // row's vehicle_type matches the category it describes.
  if (vehicleType && CAR_SUV_TYPES.has(vehicleType)) {
    applyIntSpecs(specs, row, CAR_SUV_INT_SPECS);

    const driveType = coerceText(row.raw['drive_type'])?.toUpperCase().replace(/[\s-]/g, '');
    if (driveType && (DRIVE_TYPES as readonly string[]).includes(driveType)) {
      specs.drive_type = driveType;
    }
  }

  if (vehicleType && BIKE_TYPES.has(vehicleType)) {
    applyEnumSpec(specs, row, 'stroke_type', STROKE_TYPES);
    applyEnumSpec(specs, row, 'cooling_system', COOLING_SYSTEMS);
    applyEnumSpec(specs, row, 'start_type', START_TYPES);

    for (const [column, key] of Object.entries(BIKE_BOOL_SPECS)) {
      const value = coerceBooleanSpec(row.raw[column]);
      if (value !== null && !(key in specs)) specs[key] = value;
    }
  }

  if (vehicleType && VAN_BUS_TYPES.has(vehicleType)) {
    applyIntSpecs(specs, row, VAN_BUS_INT_SPECS);
    applyEnumSpec(specs, row, 'roof_type', ROOF_TYPES);
    applyEnumSpec(specs, row, 'wheelbase', WHEELBASES);
    applyEnumSpec(specs, row, 'door_configuration', DOOR_CONFIGURATIONS);
  }

  if (vehicleType && TRUCK_TYPES.has(vehicleType)) {
    applyIntSpecs(specs, row, TRUCK_INT_SPECS);
    applyEnumSpec(specs, row, 'cargo_bed_type', CARGO_BED_TYPES);
  }

  // Equipment: applies to every type except the ones in NO_COMFORT_EQUIPMENT_TYPES,
  // since a van or truck can have a sunroof or full option just as a car can.
  for (const [column, key] of Object.entries(BOOL_SPECS)) {
    // Comfort equipment is not stored on a bike or three-wheeler; see
    // findInapplicableColumns, which reports it.
    if (
      vehicleType &&
      NO_COMFORT_EQUIPMENT_TYPES.has(vehicleType) &&
      COMFORT_EQUIPMENT_KEYS.has(key)
    ) {
      continue;
    }
    const value = coerceBooleanSpec(row.raw[column]);
    // First column wins: "alloys" and "alloy_wheels" in the same file map to
    // one key, and a later blank must not overwrite an earlier true.
    if (value !== null && !(key in specs)) specs[key] = value;
  }

  addDynamicSpecs(row, specs);

  return specs;
}

function applyIntSpecs(
  specs: Record<string, unknown>,
  row: ValidatedRow,
  table: Record<string, { column: string; min: number; max: number }>,
): void {
  for (const [column, spec] of Object.entries(table)) {
    const value = coerceInteger(row.raw[column]);
    // Out-of-range is dropped rather than clamped: 200 seats is a typo, and
    // clamping it to 60 would invent a plausible-looking fact.
    if (value !== null && value >= spec.min && value <= spec.max) {
      specs[spec.column] = value;
    }
  }
}

/** Reads a category-specific enum column, storing it only if it matches the allowed list exactly. */
function applyEnumSpec(
  specs: Record<string, unknown>,
  row: ValidatedRow,
  column: string,
  allowed: readonly string[],
): void {
  const raw = coerceText(row.raw[column])?.toUpperCase().replace(/[\s-]/g, '_');
  if (raw && allowed.includes(raw)) {
    specs[column] = raw;
  }
}

function addDynamicSpecs(row: ValidatedRow, specs: Record<string, unknown>): void {
  let added = 0;

  for (const [column, raw] of Object.entries(row.raw)) {
    if (added >= MAX_DYNAMIC_SPEC_KEYS) break;
    if (CONSUMED_COLUMNS.has(column)) continue;

    const value = coerceText(raw);
    if (!value) continue;

    specs[column] = value.length > MAX_DYNAMIC_SPEC_VALUE_LENGTH
      ? `${value.slice(0, MAX_DYNAMIC_SPEC_VALUE_LENGTH - 1)}…`
      : value;
    added += 1;
  }
}

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
 * aliases apply - "saloon" is SEDAN and "jeep" is SUV in Sri Lankan usage, and
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
