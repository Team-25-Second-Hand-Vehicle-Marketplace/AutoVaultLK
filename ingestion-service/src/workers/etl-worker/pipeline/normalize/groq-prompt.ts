import { clampReasoning } from '../types';
import type { DictionarySnapshot, NormalizedRow } from '../types';
import {
  CONDITIONS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
} from './enum-vocabulary';
import { trigramSimilarity } from './trigram';

/**
 * The system prompt for whole-row repair.
 *
 * Originally scoped to make/model only. Widened because the six fields
 * validateRows now requires (fuel_type, transmission, color,
 * engine_capacity_cc, owners_count, location_district — SRS Appendix A) can
 * arrive misspelled ("manul"), blank, or only ever stated in free-text
 * description ("1.5L turbo petrol hybrid"), and none of that is fixable by
 * enum-vocabulary.ts's exact-match lookup or make/model's dictionary fuzzy
 * match. Those are structurally different failure modes needing a model that
 * can read across fields, which is exactly the "AI is for ambiguous data, not
 * dirty data" split rules-only normalization cannot make.
 *
 * Still narrow within that: the model returns a value ONLY when confident,
 * chooses only from the allowed enum lists supplied per row, and returns null
 * rather than guess — validateRows runs after this stage precisely so a field
 * the model correctly refuses to invent still fails the mandatory check with
 * an actionable reason, instead of carrying a fabricated value into the
 * database forever.
 *
 * Deliberately NOT reusing marketplace's groq-prompt.ts: that one validates
 * *query filters* from buyer text, a different shape with a different failure
 * mode.
 */
export const SYSTEM_PROMPT = `You repair vehicle listing data from a Sri Lankan dealer's inventory spreadsheet. The rules-based parser could not confidently resolve one or more fields on each row you are given.

You will receive a JSON array of rows. Each row has an id, the raw text the dealer typed for make/model/fuel_type/transmission/color/engine_capacity_cc/owners_count/location_district, and the free-text description column verbatim.

For each row, return your best value for EVERY field listed below, or null if you cannot determine it with confidence. Fields present in the row that were NOT ambiguous still repeat what was in the row (do not blank out a field you were not asked to fix).

Fields and rules:
- make, model: choose ONLY from the allowed makes/models supplied in the user message for that row. Never invent one. Ignore trim levels, grades and years in the text.
- fuel_type: one of ${FUEL_TYPES.join(', ')}, or null.
- transmission: one of ${TRANSMISSION_TYPES.join(', ')}, or null.
- condition: one of ${CONDITIONS.join(', ')}, or null.
- color: a short plain color name (e.g. "White", "Pearl White"), or null.
- engine_capacity_cc: an integer in cc, or null.
- owners_count: an integer number of previous owners, or null.
- location_district: a Sri Lankan administrative district name, or null.

You MAY infer any of these from the free-text description when a column is blank or unparseable and the description clearly states it — e.g. description "1.5L turbo petrol hybrid" implies fuel_type HYBRID and engine_capacity_cc 1500. You MUST NOT infer a field the description does not actually support; return null instead of guessing.

Convert prose numbers to plain integers: "95k" or "95,000 km" -> 95000; "8.5m" or "around 8.5 million" -> 8500000. Do this for engine_capacity_cc the same way if it is written as prose ("1500cc", "1.5L" -> 1500).

Never invent a make, model, or any enum value outside the allowed lists. If genuinely ambiguous, return null and explain why in "reasoning" rather than guess — a wrong value stored is worse than an honest gap validateRows can report to the dealer.

When you return a non-null value for any field, add a one-sentence "reasoning" explaining the repair in plain English for a dealer reviewing the change, e.g. "Corrected misspelling; Corolla Axio matches the allowed Corolla model." or "Fuel type not given, but description states 'petrol hybrid'." Omit reasoning (or use null) when nothing on the row needed a repair.

Respond with JSON only, in this exact shape:
{"rows":[{"id":1,"make":"Toyota","model":"Corolla","fuel_type":"PETROL","transmission":"MANUAL","condition":"USED","color":"White","engine_capacity_cc":1500,"owners_count":1,"location_district":"Colombo","reasoning":"Corrected misspelling of Toyota Corolla; transmission 'manul' matched to MANUAL."}]}`;

/** What the model sees for one row. Raw text only — no prices, no invented context. */
type PromptRow = {
  id: number;
  make: string;
  model: string;
  fuel_type: string;
  transmission: string;
  condition: string;
  color: string;
  engine_capacity_cc: string;
  owners_count: string;
  location_district: string;
  description: string;
};

const MAX_FIELD_LENGTH = 60;
/** Longer than the other fields: the whole point of sending it is cross-field context. */
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * How many makes stay in the prompt per batch, at most. Enough headroom for
 * a batch whose rows span several genuinely different makes, without paying
 * for the whole dictionary on every request.
 */
const MAX_CANDIDATE_MAKES = 8;

/**
 * Below this trigram score a make is not a plausible candidate for what the
 * dealer typed — same floor dictionary-snapshot.ts's fuzzy match uses, so a
 * make Groq would never have resolved locally anyway is not worth a slot in
 * an already-tight vocabulary budget.
 */
const CANDIDATE_MAKE_THRESHOLD = 0.3;

/**
 * Builds the user payload: the rows to repair plus the makes and models they
 * are allowed to resolve to. Every other field's allowed vocabulary is fixed
 * and already stated in SYSTEM_PROMPT, so only make/model need a per-request
 * candidate list.
 *
 * **The allowed list is scoped to candidate makes, not the whole
 * dictionary.** This used to be true only in the doc comment — every call
 * actually sent the full ~30-make, ~140-model vocabulary regardless of what
 * the batch needed, which was the dominant cost in a real 429/413 against
 * Groq's free-tier 8,000 TPM limit: ~30 makes and their full model lists ran
 * to roughly 700-900 tokens on their own, before a single row's data. Now
 * each batch's candidate list is the union of, per row, the makes whose
 * canonical name or alias trigram-matches the dealer's raw text above
 * CANDIDATE_MAKE_THRESHOLD — the same floor the deterministic fuzzy match
 * uses — capped at MAX_CANDIDATE_MAKES. A make nothing in the batch is even
 * close to typing is not a candidate Groq needs to see; sending it anyway
 * both costs tokens and invites the model to pattern-match toward something
 * unrelated to what the dealer wrote.
 *
 * Falls back to the full make list only when nothing in the batch scores
 * above the threshold against anything — better to offer every option than
 * none when the raw text is too garbled to narrow down at all.
 */
export function buildUserPayload(
  rows: NormalizedRow[],
  dictionary: DictionarySnapshot,
  allowedMakes: readonly string[],
  modelsByMake: ReadonlyMap<string, readonly string[]>,
): string {
  const candidateMakes = selectCandidateMakes(rows, allowedMakes);
  const scopedModelsByMake = new Map(
    candidateMakes.map((make) => [make, modelsByMake.get(make) ?? []]),
  );

  const promptRows: PromptRow[] = rows.map((row) => ({
    id: row.rowNumber,
    make: (row.raw['make'] ?? '').slice(0, MAX_FIELD_LENGTH),
    model: (row.raw['model'] ?? '').slice(0, MAX_FIELD_LENGTH),
    fuel_type: (row.raw['fuel_type'] ?? '').slice(0, MAX_FIELD_LENGTH),
    transmission: (row.raw['transmission'] ?? '').slice(0, MAX_FIELD_LENGTH),
    condition: (row.raw['condition'] ?? '').slice(0, MAX_FIELD_LENGTH),
    color: (row.raw['color'] ?? '').slice(0, MAX_FIELD_LENGTH),
    engine_capacity_cc: (row.raw['engine_capacity_cc'] ?? '').slice(0, MAX_FIELD_LENGTH),
    owners_count: (row.raw['owners_count'] ?? '').slice(0, MAX_FIELD_LENGTH),
    location_district: (row.raw['location_district'] ?? '').slice(0, MAX_FIELD_LENGTH),
    description: (row.raw['description'] ?? '').slice(0, MAX_DESCRIPTION_LENGTH),
  }));

  return JSON.stringify({
    allowed: {
      makes: candidateMakes,
      models: Object.fromEntries(scopedModelsByMake),
      fuel_type: FUEL_TYPES,
      transmission: TRANSMISSION_TYPES,
      condition: CONDITIONS,
    },
    rows: promptRows,
  });
}

/**
 * The makes worth sending for this batch: every allowed make whose trigram
 * similarity to any row's raw make text clears CANDIDATE_MAKE_THRESHOLD,
 * ranked by best score across the batch and capped at MAX_CANDIDATE_MAKES.
 * Falls back to the full list when nothing scores above the threshold at
 * all — a batch of raw text too garbled to narrow down gets every option
 * rather than an empty (and useless) candidate list.
 */
function selectCandidateMakes(
  rows: NormalizedRow[],
  allowedMakes: readonly string[],
): readonly string[] {
  const bestScoreByMake = new Map<string, number>();

  for (const row of rows) {
    const rawMake = row.raw['make'];
    if (!rawMake) continue;

    for (const make of allowedMakes) {
      const score = trigramSimilarity(rawMake, make);
      if (score < CANDIDATE_MAKE_THRESHOLD) continue;

      const existing = bestScoreByMake.get(make) ?? 0;
      if (score > existing) bestScoreByMake.set(make, score);
    }
  }

  if (bestScoreByMake.size === 0) return allowedMakes;

  return [...bestScoreByMake.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CANDIDATE_MAKES)
    .map(([make]) => make);
}

/** One repaired row, after parsing but before whitelist validation. */
export type GroqRepair = {
  id: number;
  make: string | null;
  model: string | null;
  fuelType: string | null;
  transmission: string | null;
  condition: string | null;
  color: string | null;
  engineCapacityCc: number | null;
  ownersCount: number | null;
  locationDistrict: string | null;
  /**
   * The model's stated reason for the repair (FR-42.1), already clamped to
   * MAX_REASONING_LENGTH. Undefined when Groq omitted it or repaired nothing
   * for this row.
   */
  reasoning?: string;
};

/**
 * Reads the model's response into a typed shape, discarding anything malformed.
 *
 * Tolerant by design: a single bad entry drops that row's repair rather than
 * failing the batch, because the rows still carry their deterministic values
 * and are no worse off than if Groq had been unreachable. Enum-shaped fields
 * are read as raw strings here — applyRepairs is what checks them against
 * enum-vocabulary.ts before anything is written, exactly as make/model are
 * checked against the dictionary rather than trusted as typed here.
 */
export function parseRepairs(parsed: unknown): GroqRepair[] {
  const rows = (parsed as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) return [];

  const repairs: GroqRepair[] = [];

  for (const entry of rows) {
    if (!entry || typeof entry !== 'object') continue;

    const {
      id,
      make,
      model,
      fuel_type: fuelType,
      transmission,
      condition,
      color,
      engine_capacity_cc: engineCapacityCc,
      owners_count: ownersCount,
      location_district: locationDistrict,
      reasoning,
    } = entry as Record<string, unknown>;

    if (typeof id !== 'number' || !Number.isInteger(id)) continue;

    const repair: GroqRepair = {
      id,
      make: nonEmptyString(make),
      model: nonEmptyString(model),
      fuelType: nonEmptyString(fuelType),
      transmission: nonEmptyString(transmission),
      condition: nonEmptyString(condition),
      color: nonEmptyString(color),
      engineCapacityCc: finiteInteger(engineCapacityCc),
      ownersCount: finiteInteger(ownersCount),
      locationDistrict: nonEmptyString(locationDistrict),
    };

    if (typeof reasoning === 'string' && reasoning.trim()) {
      repair.reasoning = clampReasoning(reasoning.trim());
    }

    repairs.push(repair);
  }

  return repairs;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}
