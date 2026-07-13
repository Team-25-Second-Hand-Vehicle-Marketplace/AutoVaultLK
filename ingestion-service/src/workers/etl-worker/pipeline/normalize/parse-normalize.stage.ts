import type { VehicleType } from '../../../../infrastructure/database/entities/vehicle.write-entity';
import type {
  DictionaryHit,
  FieldProvenance,
  NormalizationProvenance,
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

const NEUTRAL = 1.0;

/** Nothing recognisable in a field the dealer did fill in. */
const CONFIDENCE_UNRESOLVED = 0;

export const parseNormalizeStage: StageRunner<
  RawRow[],
  StageResult<NormalizedRow>
> = {
  stage: 'PARSE_NORMALIZE',

  async run(
    ctx: StageContext,
    rows: RawRow[],
  ): Promise<StageResult<NormalizedRow>> {
    return {
      rows: rows.map((row) => normalizeRow(ctx, row)),
      rejections: [],
    };
  },
};

function normalizeRow(ctx: StageContext, row: RawRow): NormalizedRow {
  const cell = (name: string): string | undefined => row.raw[name];
  const scores: number[] = [];
  const provenance: NormalizationProvenance = {};

  /**
   * Records both the row-level score and this field's own provenance entry in
   * one call, so the two cannot drift - a field scored here but missing from
   * `provenance` would silently vanish from the review UI's field list while
   * still counting toward the row's confidence.
   */
  const record = (
    field: keyof VehicleFields,
    raw: string | undefined,
    confidence: number,
    source: FieldProvenance['source'],
  ): void => {
    if (coerceText(raw) === null) return;
    scores.push(confidence);
    provenance[field] = { source, confidence };
  };

  const recordProvenanceOnly = (
    field: keyof VehicleFields,
    value: unknown,
    confidence: number,
    source: FieldProvenance['source'],
  ): void => {
    if (value === undefined || value === null) return;
    provenance[field] = { source, confidence };
  };

  const normalized: Partial<VehicleFields> = {};

  // --- make, then model scoped to it -------------------------------------
  const makeHit = ctx.dictionary.resolveMake(cell('make') ?? '');
  if (makeHit) normalized.make = makeHit.canonical;
  record(
    'make',
    cell('make'),
    makeHit?.confidence ?? CONFIDENCE_UNRESOLVED,
    'dictionary',
  );

  // A model is only meaningful under a known make: "Civic" resolves under
  // Honda and must not resolve under Toyota. resolveModel enforces that, and
  // returns null outright when the make itself is unresolved.
  const modelHit = ctx.dictionary.resolveModel(
    cell('model') ?? '',
    makeHit?.id ?? null,
  );
  if (modelHit) normalized.model = modelHit.canonical;
  record(
    'model',
    cell('model'),
    modelHit?.confidence ?? CONFIDENCE_UNRESOLVED,
    'dictionary',
  );

  // --- vehicle_type: dealer's value first, dictionary second -------------
  // Sourced 'dictionary' even for the explicit-value branch: deriveVehicleType
  // still validates the dealer's own text against coerceVehicleType's
  // vocabulary, so this is never a bare pass-through of raw input.
  //
  // Scored (and thus routed toward Groq on a miss) only when the dealer
  // supplied the column themselves - record() preserves that, unchanged from
  // before provenance existed. A value silently derived from the model/make
  // still gets a provenance entry via recordProvenanceOnly, because FR-42.1's
  // review UI should be able to say "we inferred PICKUP from the Hilux model"
  // even though that derivation never affected whether Groq was consulted.
  const vehicleType = deriveVehicleType(
    cell('vehicle_type'),
    modelHit,
    makeHit,
  );
  if (vehicleType.value) normalized.vehicleType = vehicleType.value;
  record(
    'vehicleType',
    cell('vehicle_type'),
    vehicleType.confidence,
    'dictionary',
  );
  recordProvenanceOnly(
    'vehicleType',
    vehicleType.value,
    vehicleType.confidence,
    'dictionary',
  );

  // --- numerics ----------------------------------------------------------
  assignNumber(normalized, 'manufactureYear', coerceYear(cell('year')));
  assignNumber(
    normalized,
    'registrationYear',
    coerceYear(cell('registration_year')),
  );
  assignNumber(normalized, 'price', coerceNumber(cell('price')));
  assignNumber(normalized, 'mileage', coerceInteger(cell('mileage')));
  assignNumber(
    normalized,
    'engineCapacityCc',
    coerceInteger(cell('engine_capacity_cc')),
  );
  assignNumber(normalized, 'ownersCount', coerceInteger(cell('owners_count')));

  record(
    'manufactureYear',
    cell('year'),
    coerceYear(cell('year')) === null ? CONFIDENCE_UNRESOLVED : NEUTRAL,
    'rule',
  );
  record(
    'price',
    cell('price'),
    coerceNumber(cell('price')) === null ? CONFIDENCE_UNRESOLVED : NEUTRAL,
    'rule',
  );
  record(
    'mileage',
    cell('mileage'),
    coerceInteger(cell('mileage')) === null ? CONFIDENCE_UNRESOLVED : NEUTRAL,
    'rule',
  );

  // --- enums -------------------------------------------------------------
  const fuelType = coerceFuelType(cell('fuel_type'));
  if (fuelType) normalized.fuelType = fuelType;
  record(
    'fuelType',
    cell('fuel_type'),
    fuelType ? NEUTRAL : CONFIDENCE_UNRESOLVED,
    'rule',
  );

  const transmission = coerceTransmission(cell('transmission'));
  if (transmission) normalized.transmissionType = transmission;
  record(
    'transmissionType',
    cell('transmission'),
    transmission ? NEUTRAL : CONFIDENCE_UNRESOLVED,
    'rule',
  );

  // Condition is left absent when unrecognised rather than defaulted here -
  // enrich (§A6) applies `USED` deliberately, and doing it in two places would
  // make the default impossible to find.
  const condition = coerceCondition(cell('condition'));
  if (condition) normalized.condition = condition;
  record(
    'condition',
    cell('condition'),
    condition ? NEUTRAL : CONFIDENCE_UNRESOLVED,
    'rule',
  );

  // --- free text ---------------------------------------------------------
  assignText(normalized, 'color', coerceText(cell('color')));
  assignText(normalized, 'locationCity', coerceText(cell('location_city')));
  assignText(
    normalized,
    'locationDistrict',
    coerceText(cell('location_district')),
  );
  assignText(normalized, 'chassisNumber', coerceText(cell('chassis_number')));
  assignText(normalized, 'description', coerceText(cell('description')));

  const registration = coerceRegistrationNumber(cell('registration_number'));
  if (registration) normalized.registrationNumber = registration;

  const negotiable = coerceBoolean(cell('is_negotiable'));
  if (negotiable !== null) normalized.isNegotiable = negotiable;

  return {
    ...row,
    normalized,
    confidence:
      scores.length === 0 ? CONFIDENCE_UNRESOLVED : Math.min(...scores),
    provenance,
  };
}

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
  if (value !== null)
    (target as Record<string, unknown>)[key as string] = value;
}

function assignText<K extends keyof VehicleFields>(
  target: Partial<VehicleFields>,
  key: K,
  value: string | null,
): void {
  if (value !== null)
    (target as Record<string, unknown>)[key as string] = value;
}
