import type {
  EtlStage,
  EtlStageStatus,
} from '../../../infrastructure/database/entities/etl-stage-log.entity';
import type { VehicleWriteEntity } from '../../../infrastructure/database/entities/vehicle.write-entity';
import type { ObjectStore } from '../../../infrastructure/ports/object-store.port';

/**
 * The ETL stage contract (ADR-007).
 *
 * Every stage is a plain object with a `run` method. A stage must NOT import
 * NestJS, must NOT import an AWS SDK, and must NOT open a database connection
 * except through a port handed to it in StageContext. That is what lets the
 * same code run under LocalOrchestrator today and behind a Lambda handler after
 * deployment without touching a single stage.
 *
 * The rule that shapes everything else: **a stage never throws because a row is
 * bad.** Bad rows come back as `rejections` and travel with the batch; only
 * infrastructure failure (storage unreachable, database down) throws. This is
 * what makes PARTIAL job status and per-row ingestion.rejected_records fall out
 * of the design instead of needing special-casing at every level.
 */
export interface StageRunner<TIn, TOut> {
  readonly stage: EtlStage;
  run(ctx: StageContext, input: TIn): Promise<TOut>;
}

/** Everything a stage may reach. Anything absent here is off-limits by design. */
export type StageContext = {
  jobId: string;
  /** Owning dealer. Always sourced from the job row, never from the CSV. */
  dealerId: string;
  /** null for whole-file stages (validateFile, splitChunks, aggregate, notify). */
  chunkId: number | null;
  store: ObjectStore;
  dictionary: DictionarySnapshot;
  config: PipelineConfig;
};

export type PipelineConfig = {
  /** Mirrors the Step Functions Map state's MaxConcurrency (SAD §6.6). */
  maxConcurrency: number;
  chunkSize: number;
  /** Rows below this confidence are routed to the Groq fallback. */
  groqConfidenceThreshold: number;
  embeddingDisabled: boolean;
};

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------

/**
 * Loaded once per pipeline run and held in memory — never queried per row.
 * That is what keeps the `extra: { max: 5 }` connection-pool argument in
 * config/database.config.ts intact under MaxConcurrency: 10.
 */
export interface DictionarySnapshot {
  resolveMake(raw: string): DictionaryHit | null;
  /** Models are children of a make, so resolution is scoped to the make's id. */
  resolveModel(raw: string, makeId: string | null): DictionaryHit | null;
  /** BODY_TYPE / COLOR and any other flat dictionary type. */
  resolve(type: string, raw: string): DictionaryHit | null;

  /**
   * Every canonical make, and the models under each.
   *
   * Exists for the Groq stage's whitelist: the model is given the allowed
   * vocabulary in its prompt, and every value it returns is checked against
   * this before being written. An LLM inventing "Toyota Supra" — a real
   * vehicle, absent from this dictionary — would otherwise produce a pair no
   * search facet, filter or lookup can ever match, which is worse than the
   * unresolved value it replaced.
   */
  vocabulary(): DictionaryVocabulary;
}

export type DictionaryVocabulary = {
  makes: string[];
  /** Canonical make -> its canonical model names. */
  modelsByMake: Map<string, string[]>;
};

export type DictionaryHit = {
  id: string;
  canonical: string;
  /**
   * Which marketplace.vehicles.vehicle_type values this entry applies to
   * (migration 21000). parseNormalize derives vehicle_type from this, because
   * the dealer CSV contract does not require the column. Empty = any type.
   */
  vehicleTypes: string[];
  /** 1.0 exact canonical, ~0.8 alias, ~0.6 fuzzy. Feeds the Groq threshold. */
  confidence: number;
};

// ---------------------------------------------------------------------------
// Row shapes, in the order the pipeline produces them
// ---------------------------------------------------------------------------

/** Straight out of the CSV/JSON parser. rowNumber is 1-based, header excluded. */
export type RawRow = {
  rowNumber: number;
  raw: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Normalization provenance (FR-42.1)
// ---------------------------------------------------------------------------

/**
 * Where one field's value came from, and how sure the pipeline is of it.
 *
 * `rule` covers everything parseNormalize resolves deterministically without
 * a dictionary lookup — a parsed number, a matched enum keyword. `dictionary`
 * is a make/model (or any DictionaryHit-backed field) resolved against
 * ctx.dictionary, whether the hit was exact, alias or fuzzy; the distinction
 * between those already lives in `confidence`, so the source label does not
 * need to repeat it. `raw` is a field carried through unparsed (free text like
 * description, or a value coerced but not looked up against any vocabulary).
 * `groq` is a value the Groq fallback supplied — currently make/model only,
 * see groq-normalize.stage.ts.
 *
 * `reasoning` is populated only for `groq` entries whose value Groq actually
 * changed, and only when Groq returns one — the deterministic paths have
 * nothing to explain beyond the source itself, and asking Groq to justify
 * every row (not just the ones it resolves) would widen the request FR-33.7
 * says to keep minimal.
 */
export type FieldSource = 'rule' | 'dictionary' | 'raw' | 'groq';

export type FieldProvenance = {
  source: FieldSource;
  confidence: number;
  /** varchar(500) in marketplace.vehicles — see MAX_REASONING_LENGTH below. */
  reasoning?: string;
};

/**
 * Per-field provenance for one row, keyed by VehicleFields property name.
 *
 * Only fields the dealer actually supplied something for are present — the
 * same rule parseNormalize's own `record()` already follows for row-level
 * confidence (a blank optional column is not evidence of anything, so it does
 * not get an entry either).
 */
export type NormalizationProvenance = Partial<
  Record<keyof VehicleFields, FieldProvenance>
>;

/**
 * After parseNormalize, and optionally groqNormalize. Not yet validated.
 *
 * `provenance` is optional on the type rather than required: every row the
 * running pipeline produces carries one (parseNormalizeStage always sets it),
 * but making it mandatory would force every NormalizedRow literal across the
 * test suite — which builds rows by hand to exercise validateRows, enrich,
 * embed and load in isolation from parseNormalize — to fabricate provenance
 * data those tests have no reason to care about. Call sites that need it
 * (the review UI's mapping, groqNormalize's merge) default a missing value to
 * `{}` rather than assuming it is present.
 */
export type NormalizedRow = RawRow & {
  normalized: Partial<VehicleFields>;
  /** Lowest field-level confidence in the row; below threshold routes to Groq. */
  confidence: number;
  /** Per-field provenance backing FR-42.1's review UI. */
  provenance?: NormalizationProvenance;
};

/** Survived validateRows: every required field present and in range. */
export type ValidatedRow = NormalizedRow & {
  normalized: VehicleFields;
};

/** After enrich — specs, status and defaults filled in. */
export type EnrichedRow = ValidatedRow;

/**
 * After embed. `embedding` is null when EMBEDDING_DISABLED is set or MiniLM
 * degraded; that is not a row failure, matching the manual-listing path in
 * marketplace-service's ListingSearchIndexService.
 */
export type EmbeddedRow = EnrichedRow & {
  searchText: string | null;
  embedding: string | null;
};

/**
 * The writable column set of marketplace.vehicles.
 *
 * Deliberately Pick<>-ed from the write entity rather than restated: renaming a
 * column there breaks the build here instead of silently dropping the field on
 * write. `id`, `dealerId`, `uploadJobId`, `status`, `searchText`, `embedding`
 * and the timestamps are excluded — the Load adapter owns those, not the
 * normalizer, and dealer CSV content must never be able to set them.
 */
export type VehicleFields = Pick<
  VehicleWriteEntity,
  | 'vehicleType'
  | 'make'
  | 'model'
  | 'condition'
  | 'manufactureYear'
  | 'price'
  | 'mileage'
> &
  Partial<
    Pick<
      VehicleWriteEntity,
      | 'registrationYear'
      | 'isNegotiable'
      | 'fuelType'
      | 'transmissionType'
      | 'engineCapacityCc'
      | 'color'
      | 'ownersCount'
      | 'locationCity'
      | 'locationDistrict'
      | 'registrationNumber'
      | 'chassisNumber'
      | 'description'
      | 'specs'
    >
  >;

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

/** A row that will not be loaded. Becomes one ingestion.rejected_records row. */
export type Rejection = {
  rowNumber: number;
  rawData: Record<string, unknown>;
  reason: string;
};

/** What most stages hand to the next one: survivors plus casualties. */
export type StageResult<TRow> = {
  rows: TRow[];
  rejections: Rejection[];
};

/** ingestion.rejected_records.reason is varchar(500). */
export const MAX_REJECTION_REASON_LENGTH = 500;

/**
 * marketplace.vehicles.normalization is JSONB with no column-width cap of its
 * own, but a `reasoning` string is stored inside it and read by a review UI
 * that renders it inline — unbounded LLM output there is a display problem
 * today and a storage-bloat one if a future run ever asks for more than one
 * sentence. Clamped the same way rejected-records' `reason` is, for the same
 * reason: an oversized value should degrade gracefully, not throw or balloon.
 */
export const MAX_REASONING_LENGTH = 500;

/** Clamps Groq's stated reasoning to a length the review UI can render inline. */
export function clampReasoning(reasoning: string): string {
  return reasoning.length > MAX_REASONING_LENGTH
    ? `${reasoning.slice(0, MAX_REASONING_LENGTH - 1)}…`
    : reasoning;
}

/**
 * The shape written to marketplace.vehicles.normalization (FR-42.1). Built by
 * the Load stage from a row's `provenance` map and `confidence`, immediately
 * before the write — see buildNormalizationPayload in
 * marketplace-vehicles-write.adapter.ts.
 */
export type NormalizationPayload = {
  fields: NormalizationProvenance;
  rowConfidence: number;
};

/**
 * Builds a Rejection with the reason clamped to the column width. Always use
 * this rather than a literal: an over-long reason throws at INSERT time and
 * takes the whole chunk's rejections down with it, so a bad error message would
 * cost more than the bad row it describes.
 */
export function rejection(row: RawRow, reason: string): Rejection {
  return {
    rowNumber: row.rowNumber,
    rawData: row.raw,
    reason:
      reason.length > MAX_REJECTION_REASON_LENGTH
        ? `${reason.slice(0, MAX_REJECTION_REASON_LENGTH - 1)}…`
        : reason,
  };
}

// ---------------------------------------------------------------------------
// Stage logging
// ---------------------------------------------------------------------------

/**
 * Writes ingestion.etl_stage_logs. Injected rather than imported so stages stay
 * free of TypeORM; the orchestrator wraps each stage in start/finish.
 */
export interface StageLogger {
  start(
    stage: EtlStage,
    chunkId: number | null,
    retryCount?: number,
  ): Promise<string>;
  finish(
    logId: string,
    status: Exclude<EtlStageStatus, 'STARTED'>,
    detail?: { metrics?: Record<string, unknown>; errorMessage?: string },
  ): Promise<void>;
}

/**
 * Binds a StageLogger to one upload job, so stages never thread the job id
 * through every log call. EtlStageLogRepository.forJob satisfies this.
 */
export type StageLoggerFactory = (uploadJobId: string) => StageLogger;
