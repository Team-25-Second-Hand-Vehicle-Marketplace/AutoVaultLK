import type {
  NormalizedRow,
  StageContext,
  StageResult,
  StageRunner,
  VehicleFields,
} from '../types';
import { CONFIDENCE_ALIAS } from './dictionary-snapshot';
import { complete, isGroqConfigured, parseGroqJson } from './groq-client';
import {
  SYSTEM_PROMPT,
  buildUserPayload,
  parseRepairs,
  type GroqRepair,
} from './groq-prompt';

/**
 * What the stage did, for the orchestrator to log. SKIPPED when no key is
 * configured or nothing needed help; DEGRADED when the call failed and rows
 * kept their deterministic values.
 */
export type GroqOutcome = 'SKIPPED' | 'SUCCEEDED' | 'DEGRADED';

export type GroqNormalizeResult = StageResult<NormalizedRow> & {
  outcome: GroqOutcome;
  metrics: { candidates: number; repaired: number };
  /** Present only on DEGRADED, for the stage log's error_message. */
  error?: string;
};

/**
 * The LLM fallback for rows the dictionary could not resolve (ADR-004:
 * rules first, LLM second).
 *
 * **Currently a pass-through.** Candidate selection, the whitelist contract and
 * the degradation posture are all real; only the HTTP call is absent, and it
 * lands once A5–A7 are green (plan §A4). Shipping the shape first is not
 * scaffolding — the pipeline must run correctly with no GROQ_API_KEY at all,
 * because CI has none and a dealer upload cannot fail because a third party is
 * down. That keyless path is the required behaviour, not a placeholder for it.
 *
 * Three rules the live call must not break:
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
export const groqNormalizeStage: StageRunner<NormalizedRow[], GroqNormalizeResult> = {
  stage: 'GROQ_NORMALIZE',

  async run(ctx: StageContext, rows: NormalizedRow[]): Promise<GroqNormalizeResult> {
    const candidates = selectCandidates(rows, ctx.config.groqConfidenceThreshold);

    // No key is the normal CI and local-development state, so this is a clean
    // SKIPPED rather than a warning: the pipeline is working as designed.
    if (!isGroqConfigured()) {
      return skipped(rows, candidates.length);
    }

    if (candidates.length === 0) {
      return skipped(rows, 0);
    }

    try {
      const repairs = await requestRepairs(ctx, candidates);
      const repaired = applyRepairs(ctx, rows, repairs);

      return {
        rows: repaired.rows,
        rejections: [],
        outcome: 'SUCCEEDED',
        metrics: { candidates: candidates.length, repaired: repaired.count },
      };
    } catch (err) {
      // Rows keep whatever parseNormalize determined and continue to
      // validateRows, which may well accept them — low confidence is not
      // invalidity. A Groq outage must cost enrichment, not stock.
      return {
        rows,
        rejections: [],
        outcome: 'DEGRADED',
        metrics: { candidates: candidates.length, repaired: 0 },
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/** One batched completion for the whole chunk's candidates. */
async function requestRepairs(
  ctx: StageContext,
  candidates: NormalizedRow[],
): Promise<GroqRepair[]> {
  const { makes, modelsByMake } = ctx.dictionary.vocabulary();
  const payload = buildUserPayload(candidates, ctx.dictionary, makes, modelsByMake);

  return parseRepairs(parseGroqJson(await complete(SYSTEM_PROMPT, payload)));
}

/**
 * Merges accepted repairs back by row number.
 *
 * **Every returned value is resolved through the dictionary before it is
 * written.** The prompt supplies the allowed vocabulary, but a prompt is a
 * request, not a constraint — models return values outside a stated list, and
 * "Toyota Corrolla" would be a make/model pair no search facet, filter or
 * dictionary lookup could ever match. Resolving rather than string-comparing
 * also means the row ends up with the same canonical spelling the
 * deterministic path would have produced.
 *
 * A repaired row is scored CONFIDENCE_ALIAS: better than the fuzzy match that
 * failed, below an exact hit, because the LLM agreed with a value we already
 * held rather than reading the vehicle's papers.
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
    if (!repair?.make) return row;

    const makeHit = ctx.dictionary.resolveMake(repair.make);
    if (!makeHit) return row;

    const normalized = { ...row.normalized, make: makeHit.canonical };

    // The model is only taken when it resolves *under the repaired make*, so a
    // model the LLM paired with the wrong manufacturer is dropped rather than
    // written against it.
    const modelHit = repair.model
      ? ctx.dictionary.resolveModel(repair.model, makeHit.id)
      : null;

    if (modelHit) {
      normalized.model = modelHit.canonical;
      // vehicle_type follows the model, exactly as parseNormalize derives it —
      // otherwise a repaired Hilux would stay typed from the make's array.
      const derived = modelHit.vehicleTypes[0];
      if (derived) normalized.vehicleType = derived as VehicleFields['vehicleType'];
    }

    count++;
    return { ...row, normalized, confidence: CONFIDENCE_ALIAS };
  });

  return { rows: merged, count };
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

function skipped(rows: NormalizedRow[], candidates: number): GroqNormalizeResult {
  return {
    rows,
    rejections: [],
    outcome: 'SKIPPED',
    metrics: { candidates, repaired: 0 },
  };
}
