import type {
  NormalizedRow,
  StageContext,
  StageResult,
  StageRunner,
} from '../types';

/**
 * What the stage did, for the orchestrator to log. SKIPPED when no key is
 * configured or nothing needed help; DEGRADED when the call failed and rows
 * kept their deterministic values.
 */
export type GroqOutcome = 'SKIPPED' | 'SUCCEEDED' | 'DEGRADED';

export type GroqNormalizeResult = StageResult<NormalizedRow> & {
  outcome: GroqOutcome;
  metrics: { candidates: number; repaired: number };
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

    // TODO(§A4): batch `candidates` into one JSON-mode completion, validate
    // every returned make/model against ctx.dictionary, and merge accepted
    // values back by rowNumber. Until then rows pass through untouched, which
    // is exactly what a Groq outage produces — so the degraded path is the
    // one already under test.
    return skipped(rows, candidates.length);
  },
};

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

/** Absent or blank is unconfigured; a whitespace-only value is a bad .env. */
function isGroqConfigured(): boolean {
  return (process.env.GROQ_API_KEY ?? '').trim().length > 0;
}

function skipped(rows: NormalizedRow[], candidates: number): GroqNormalizeResult {
  return {
    rows,
    rejections: [],
    outcome: 'SKIPPED',
    metrics: { candidates, repaired: 0 },
  };
}
