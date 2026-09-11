import type { VehicleType } from '../../../../infrastructure/database/entities/vehicle.write-entity';
import type {
  DictionaryHit,
  NormalizedRow,
  RawRow,
  StageContext,
  StageResult,
  StageRunner,
  VehicleFields,
} from '../types';
import {
  coerceBoolean,
  coerceInteger,
  coerceNumber,
  coerceRegistrationNumber,
  coerceText,
  coerceYear,
} from './coerce';
import {
  coerceCondition,
  coerceFuelType,
  coerceTransmission,
  coerceVehicleType,
} from './enum-vocabulary';

/**
 * Confidence for a field the dealer left blank but which is optional.
 *
 * Absence is not a failure — most dealer sheets carry five columns, and
 * scoring a blank `color` as a miss would drag every row below the Groq
 * threshold and send the whole file to an LLM that has nothing to work with.
 * Only fields the dealer actually filled in are scored.
 */
const NEUTRAL = 1.0;

/** Nothing recognisable in a field the dealer did fill in. */
const CONFIDENCE_UNRESOLVED = 0;

/**
 * Turns raw cells into typed, dictionary-resolved vehicle fields.
 *
 * Two rules shape this stage:
 *
 * 1. **It never rejects a row.** Even a row with no make at all comes through
 *    with `normalized.make` absent and a low confidence. validateRows (§A5) is
 *    the single gate that decides what is loadable, so there is exactly one
 *    place listing every rejection reason — and Groq (§A4) still gets a chance
 *    at rows this stage could not resolve. Rejecting here would foreclose that.
 *
 * 2. **Confidence is the minimum across fields the dealer filled in**, not the
 *    mean. A row whose make resolved exactly but whose model is unrecognised is
 *    not 80% correct; it is wrong in the field that matters, and averaging would
 *    hide that behind four confident cells.
 */
export const parseNormalizeStage: StageRunner<RawRow[], StageResult<NormalizedRow>> = {
  stage: 'PARSE_NORMALIZE',

  async run(ctx: StageContext, rows: RawRow[]): Promise<StageResult<NormalizedRow>> {
    return {
      rows: rows.map((row) => normalizeRow(ctx, row)),
      rejections: [],
    };
  },
};

function normalizeRow(ctx: StageContext, row: RawRow): NormalizedRow {
  const cell = (name: string): string | undefined => row.raw[name];
  const scores: number[] = [];

  /** Records a confidence only when the dealer supplied something to score. */
  const score = (raw: string | undefined, confidence: number): void => {
    if (coerceText(raw) !== null) scores.push(confidence);
  };

  const normalized: Partial<VehicleFields> = {};

  // --- make, then model scoped to it -------------------------------------
  const makeHit = ctx.dictionary.resolveMake(cell('make') ?? '');
  if (makeHit) normalized.make = makeHit.canonical;
  score(cell('make'), makeHit?.confidence ?? CONFIDENCE_UNRESOLVED);

  // A model is only meaningful under a known make: "Civic" resolves under
  // Honda and must not resolve under Toyota. resolveModel enforces that, and
  // returns null outright when the make itself is unresolved.
  const modelHit = ctx.dictionary.resolveModel(cell('model') ?? '', makeHit?.id ?? null);
  if (modelHit) normalized.model = modelHit.canonical;
  score(cell('model'), modelHit?.confidence ?? CONFIDENCE_UNRESOLVED);

  // --- vehicle_type: dealer's value first, dictionary second -------------
  const vehicleType = deriveVehicleType(cell('vehicle_type'), modelHit, makeHit);
  if (vehicleType.value) normalized.vehicleType = vehicleType.value;
  if (coerceText(cell('vehicle_type')) !== null) scores.push(vehicleType.confidence);

  // --- numerics ----------------------------------------------------------
  assignNumber(normalized, 'manufactureYear', coerceYear(cell('year')));
  assignNumber(normalized, 'registrationYear', coerceYear(cell('registration_year')));
  assignNumber(normalized, 'price', coerceNumber(cell('price')));
  assignNumber(normalized, 'mileage', coerceInteger(cell('mileage')));
  assignNumber(normalized, 'engineCapacityCc', coerceInteger(cell('engine_capacity_cc')));
  assignNumber(normalized, 'ownersCount', coerceInteger(cell('owners_count')));

  score(cell('year'), coerceYear(cell('year')) === null ? CONFIDENCE_UNRESOLVED : NEUTRAL);
  score(cell('price'), coerceNumber(cell('price')) === null ? CONFIDENCE_UNRESOLVED : NEUTRAL);
  score(
    cell('mileage'),
    coerceInteger(cell('mileage')) === null ? CONFIDENCE_UNRESOLVED : NEUTRAL,
  );

  // --- enums -------------------------------------------------------------
  const fuelType = coerceFuelType(cell('fuel_type'));
  if (fuelType) normalized.fuelType = fuelType;
  score(cell('fuel_type'), fuelType ? NEUTRAL : CONFIDENCE_UNRESOLVED);

  const transmission = coerceTransmission(cell('transmission'));
  if (transmission) normalized.transmissionType = transmission;
  score(cell('transmission'), transmission ? NEUTRAL : CONFIDENCE_UNRESOLVED);

  // Condition is left absent when unrecognised rather than defaulted here —
  // enrich (§A6) applies `USED` deliberately, and doing it in two places would
  // make the default impossible to find.
  const condition = coerceCondition(cell('condition'));
  if (condition) normalized.condition = condition;
  score(cell('condition'), condition ? NEUTRAL : CONFIDENCE_UNRESOLVED);

  // --- free text ---------------------------------------------------------
  assignText(normalized, 'color', coerceText(cell('color')));
  assignText(normalized, 'locationCity', coerceText(cell('location_city')));
  assignText(normalized, 'locationDistrict', coerceText(cell('location_district')));
  assignText(normalized, 'chassisNumber', coerceText(cell('chassis_number')));
  assignText(normalized, 'description', coerceText(cell('description')));

  const registration = coerceRegistrationNumber(cell('registration_number'));
  if (registration) normalized.registrationNumber = registration;

  const negotiable = coerceBoolean(cell('is_negotiable'));
  if (negotiable !== null) normalized.isNegotiable = negotiable;

  return {
    ...row,
    normalized,
    confidence: scores.length === 0 ? CONFIDENCE_UNRESOLVED : Math.min(...scores),
  };
}

/**
 * Resolves vehicle_type, preferring what the dealer wrote.
 *
 * The dealer CSV contract does not require the column, so most rows derive it
 * from the dictionary instead: the matched model's vehicle_types[] first
 * (migration 21000 — a Hilux is a PICKUP), falling back to the make's array
 * when the model did not resolve.
 *
 * The make's array is only usable when it holds exactly one value. Toyota
 * carries CAR, SUV, VAN, PICKUP and LORRY; picking the first would type every
 * unresolved Toyota as a car, including the lorries. Ambiguity is left for
 * enrich to default rather than guessed at here.
 */
function deriveVehicleType(
  raw: string | undefined,
  modelHit: DictionaryHit | null,
  makeHit: DictionaryHit | null,
): { value: VehicleType | null; confidence: number } {
  const explicit = coerceVehicleType(raw);
  if (explicit) return { value: explicit, confidence: NEUTRAL };

  const fromModel = firstVehicleType(modelHit);
  if (fromModel) {
    // Inherited confidence: a fuzzy model match yielding PICKUP is exactly as
    // trustworthy as the model match that produced it.
    return { value: fromModel, confidence: modelHit?.confidence ?? NEUTRAL };
  }

  if (makeHit?.vehicleTypes.length === 1) {
    const only = coerceVehicleType(makeHit.vehicleTypes[0]);
    if (only) return { value: only, confidence: makeHit.confidence };
  }

  return { value: null, confidence: CONFIDENCE_UNRESOLVED };
}

function firstVehicleType(hit: DictionaryHit | null): VehicleType | null {
  if (!hit || hit.vehicleTypes.length === 0) return null;
  return coerceVehicleType(hit.vehicleTypes[0]);
}

/**
 * Assigns only when parsing succeeded, so an unparseable cell leaves the field
 * absent rather than writing null over it. validateRows distinguishes "missing"
 * from "present but wrong" using exactly that.
 */
function assignNumber<K extends keyof VehicleFields>(
  target: Partial<VehicleFields>,
  key: K,
  value: number | null,
): void {
  if (value !== null) (target as Record<string, unknown>)[key as string] = value;
}

function assignText<K extends keyof VehicleFields>(
  target: Partial<VehicleFields>,
  key: K,
  value: string | null,
): void {
  if (value !== null) (target as Record<string, unknown>)[key as string] = value;
}
