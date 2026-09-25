import type {
  FieldProvenance,
  NormalizationProvenance,
  NormalizedRow,
  StageContext,
  StageResult,
  StageRunner,
  VehicleFields,
} from '../types';
import { CONFIDENCE_ALIAS } from './dictionary-snapshot';
import {
  coerceCondition,
  coerceFuelType,
  coerceTransmission,
} from './enum-vocabulary';
import { complete, isGroqConfigured, parseGroqJson } from './groq-client';
import {
  SYSTEM_PROMPT,
  buildUserPayload,
  parseRepairs,
  type GroqRepair,
} from './groq-prompt';

/**
 * What the stage did, for the orchestrator to log. SKIPPED when no key is
 * configured or nothing needed help; DEGRADED when at least one sub-batch's
 * call failed and those rows kept their deterministic values; SUCCEEDED when
 * every sub-batch that was attempted came back — including a chunk where
 * some sub-batches succeeded and others degraded, since the rows that did
 * get repaired should not be reported as a wholesale failure.
 */
export type GroqOutcome = 'SKIPPED' | 'SUCCEEDED' | 'DEGRADED';

export type GroqNormalizeResult = StageResult<NormalizedRow> & {
  outcome: GroqOutcome;
  metrics: { candidates: number; repaired: number; batches: number; failedBatches: number };
  /** Present only when at least one sub-batch degraded, for the stage log's error_message. */
  error?: string;
};

/**
 * Candidates per Groq request, not per chunk.
 *
 * A whole chunk's low-confidence rows (up to INGESTION_CHUNK_SIZE, 250 by
 * default) sent in one request routinely exceeded Groq's free-tier 8,000
 * TPM limit once the full ~30-make dictionary vocabulary was included in the
 * same payload — observed directly against the API as a 413 ("Request too
 * large") on the first chunk and a 429 on the second, degrading Groq
 * normalization on every realistically-sized file. Splitting into small
 * sub-batches keeps each request's token count well under the cap
 * regardless of chunk size, at the cost of more sequential round trips per
 * chunk instead of one.
 */
const GROQ_BATCH_SIZE = 8;

/**
 * The LLM fallback for rows the dictionary could not resolve (ADR-004:
 * rules first, LLM second).
 *
 * **The keyless path is required behaviour, not a fallback.** CI has no key
 * and a dealer upload cannot fail because a third party is down, so with
 * GROQ_API_KEY unset the stage logs SKIPPED and rows pass through untouched —
 * exactly what a Groq outage produces.
 *
 * Three rules the live call does not break:
 *
 * 1. **Every returned value is checked against the dictionary snapshot.** An
 *    LLM inventing "Toyota Corrolla" would otherwise write a make/model pair
 *    that no search facet, filter or dictionary lookup can ever match. Values
 *    absent from the snapshot are dropped, not stored.
 *
 * 2. **Failure degrades, never rejects.** Rows keep whatever parseNormalize
 *    determined and continue to validateRows, which may well accept them —
 *    low confidence is not invalidity. A Groq outage must cost enrichment,
 *    not stock.
 *
 * 3. **It never rejects a row.** Same reason as parseNormalize: validateRows
 *    is the single gate.
 */
export const groqNormalizeStage: StageRunner<
  NormalizedRow[],
  GroqNormalizeResult
> = {
  stage: 'GROQ_NORMALIZE',

  async run(
    ctx: StageContext,
    rows: NormalizedRow[],
  ): Promise<GroqNormalizeResult> {
    const candidates = selectCandidates(
      rows,
      ctx.config.groqConfidenceThreshold,
    );

    // No key is the normal CI and local-development state, so this is a clean
    // SKIPPED rather than a warning: the pipeline is working as designed.
    if (!isGroqConfigured()) {
      return skipped(rows, candidates.length);
    }

    if (candidates.length === 0) {
      return skipped(rows, 0);
    }

    // Sequential, not Promise.all: parallel sub-batches would just recreate
    // the same per-minute token ceiling this splitting exists to avoid,
    // firing several large requests at once instead of one.
    const batches = chunkInto(candidates, GROQ_BATCH_SIZE);
    let mergedRows = rows;
    let repairedCount = 0;
    let failedBatches = 0;
    const errors: string[] = [];

    for (const batch of batches) {
      try {
        const repairs = await requestRepairs(ctx, batch);
        const result = applyRepairs(ctx, mergedRows, repairs);
        mergedRows = result.rows;
        repairedCount += result.count;
      } catch (err) {
        // This batch's rows keep whatever parseNormalize determined and
        // continue to validateRows, which may well accept them — low
        // confidence is not invalidity. One batch failing must not discard
        // repairs another batch in the same chunk already made.
        failedBatches++;
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const metrics = {
      candidates: candidates.length,
      repaired: repairedCount,
      batches: batches.length,
      failedBatches,
    };

    if (failedBatches === 0) {
      return { rows: mergedRows, rejections: [], outcome: 'SUCCEEDED', metrics };
    }

    return {
      rows: mergedRows,
      rejections: [],
      outcome: 'DEGRADED',
      metrics,
      error: errors.join(' | '),
    };
  },
};

/** Splits an array into consecutive groups of at most `size`. */
function chunkInto<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/** One completion for one sub-batch of candidates. */
async function requestRepairs(
  ctx: StageContext,
  candidates: NormalizedRow[],
): Promise<GroqRepair[]> {
  const { makes, modelsByMake } = ctx.dictionary.vocabulary();
  const payload = buildUserPayload(
    candidates,
    ctx.dictionary,
    makes,
    modelsByMake,
  );

  return parseRepairs(parseGroqJson(await complete(SYSTEM_PROMPT, payload)));
}

/**
 * Merges accepted repairs back by row number.
 *
 * **Every returned value is validated before it is written** — make/model
 * through the dictionary, the enum fields through enum-vocabulary.ts's exact
 * lookup, engine_capacity_cc/owners_count as positive integers. The prompt
 * states the allowed vocabulary, but a prompt is a request, not a constraint:
 * a model returning a value outside the stated list is dropped, not stored,
 * for the same reason an invented make/model pair is dropped — a facet or
 * filter that can never match it is worse than an honest absence.
 *
 * **A field already resolved by parseNormalize is never overwritten.** Groq
 * is asked to repair the row as a whole so it has enough context to read
 * fuel_type out of a description when the fuel_type column is blank, but a
 * cell the rules-only pass already resolved correctly (e.g. transmission
 * "Automatic") must not be replaced by a model's independent (and possibly
 * different) opinion of the same cell.
 *
 * A repaired field is scored CONFIDENCE_ALIAS: better than the fuzzy match
 * that failed, below an exact hit, because the LLM agreed with (or inferred)
 * a value rather than reading the vehicle's papers. FR-42.1: every repaired
 * field gets a `source: 'groq'` provenance entry, with `reasoning` attached
 * when Groq supplied one — only fields Groq actually changed are marked.
 */
function applyRepairs(
  ctx: StageContext,
  rows: NormalizedRow[],
  repairs: GroqRepair[],
): { rows: NormalizedRow[]; count: number } {
  if (repairs.length === 0) return { rows, count: 0 };

  const byRow = new Map(repairs.map((repair) => [repair.id, repair]));
  let count = 0;

  const merged = rows.map((row) => {
    const repair = byRow.get(row.rowNumber);
    if (!repair) return row;

    let normalized = { ...row.normalized };
    let provenance: NormalizationProvenance = { ...row.provenance };
    let touched = false;

    const markTouched = () => {
      touched = true;
    };

    if (repair.make) {
      const makeHit = ctx.dictionary.resolveMake(repair.make);
      if (makeHit) {
        normalized.make = makeHit.canonical;
        provenance.make = groqProvenance(repair.reasoning);
        markTouched();

        // The model is only taken when it resolves *under the repaired make*,
        // so a model the LLM paired with the wrong manufacturer is dropped
        // rather than written against it.
        const modelHit = repair.model
          ? ctx.dictionary.resolveModel(repair.model, makeHit.id)
          : null;

        if (modelHit) {
          normalized.model = modelHit.canonical;
          // vehicle_type follows the model, exactly as parseNormalize derives
          // it — otherwise a repaired Hilux would stay typed from the make's
          // array.
          const derived = modelHit.vehicleTypes[0];
          if (derived) {
            normalized.vehicleType = derived as VehicleFields['vehicleType'];
          }
          provenance.model = groqProvenance(repair.reasoning);
        }
      }
    }

    touched = applyEnumRepair(
      normalized,
      provenance,
      'fuelType',
      !row.normalized.fuelType ? repair.fuelType : null,
      coerceFuelType,
      repair.reasoning,
    ) || touched;

    touched = applyEnumRepair(
      normalized,
      provenance,
      'transmissionType',
      !row.normalized.transmissionType ? repair.transmission : null,
      coerceTransmission,
      repair.reasoning,
    ) || touched;

    touched = applyEnumRepair(
      normalized,
      provenance,
      'condition',
      !row.normalized.condition ? repair.condition : null,
      coerceCondition,
      repair.reasoning,
    ) || touched;

    if (!row.normalized.color && repair.color) {
      normalized.color = repair.color.slice(0, 50);
      provenance.color = groqProvenance(repair.reasoning);
      markTouched();
    }

    if (row.normalized.engineCapacityCc === undefined && repair.engineCapacityCc) {
      normalized.engineCapacityCc = repair.engineCapacityCc;
      provenance.engineCapacityCc = groqProvenance(repair.reasoning);
      markTouched();
    }

    if (row.normalized.ownersCount === undefined && repair.ownersCount) {
      normalized.ownersCount = repair.ownersCount;
      provenance.ownersCount = groqProvenance(repair.reasoning);
      markTouched();
    }

    if (!row.normalized.locationDistrict && repair.locationDistrict) {
      normalized.locationDistrict = repair.locationDistrict.slice(0, 100);
      provenance.locationDistrict = groqProvenance(repair.reasoning);
      markTouched();
    }

    if (!touched) return row;

    count++;
    return { ...row, normalized, confidence: CONFIDENCE_ALIAS, provenance };
  });

  return { rows: merged, count };
}

function groqProvenance(reasoning: string | undefined): FieldProvenance {
  return {
    source: 'groq',
    confidence: CONFIDENCE_ALIAS,
    ...(reasoning ? { reasoning } : {}),
  };
}

/**
 * Validates a Groq-proposed enum value through the same lookup
 * parseNormalize uses, and writes it only if it resolves. Returns whether it
 * wrote anything, so callers can fold several of these into one `touched`
 * flag without repeating the pattern per field.
 */
function applyEnumRepair<K extends keyof VehicleFields, T extends string>(
  normalized: Partial<VehicleFields>,
  provenance: NormalizationProvenance,
  field: K,
  rawValue: string | null,
  coerce: (raw: string | undefined) => T | null,
  reasoning: string | undefined,
): boolean {
  if (!rawValue) return false;

  const resolved = coerce(rawValue);
  if (!resolved) return false;

  (normalized as Record<string, unknown>)[field] = resolved;
  (provenance as Record<string, FieldProvenance>)[field] = groqProvenance(reasoning);
  return true;
}

/**
 * Rows whose weakest resolved field fell below the threshold.
 *
 * Strictly below, not at: a fuzzy dictionary hit scores exactly
 * CONFIDENCE_FUZZY (0.6) and the default threshold is 0.6, so a trigram match
 * the snapshot already vouched for is not re-litigated by an LLM. Only rows
 * where something genuinely failed to resolve are worth the call.
 */
export function selectCandidates(
  rows: NormalizedRow[],
  threshold: number,
): NormalizedRow[] {
  return rows.filter((row) => row.confidence < threshold);
}

function skipped(
  rows: NormalizedRow[],
  candidates: number,
): GroqNormalizeResult {
  return {
    rows,
    rejections: [],
    outcome: 'SKIPPED',
    metrics: { candidates, repaired: 0, batches: 0, failedBatches: 0 },
  };
}
