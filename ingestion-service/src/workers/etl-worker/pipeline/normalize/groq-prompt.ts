import type { DictionarySnapshot, NormalizedRow } from '../types';

/**
 * The system prompt for make/model repair.
 *
 * Narrow on purpose. The model is asked to do one thing the deterministic path
 * genuinely cannot — recognise that "toyta corola" is a Toyota Corolla when
 * trigram matching found two candidates within the ambiguity margin. It is not
 * asked to price a vehicle, guess a year, or invent a model it thinks ought to
 * exist; every one of those would be a plausible-sounding fabrication written
 * into a dealer's inventory.
 *
 * Deliberately NOT reusing marketplace's groq-prompt.ts: that one validates
 * *query filters* from buyer text, a different shape with a different failure
 * mode.
 */
export const SYSTEM_PROMPT = `You normalize vehicle make and model names from a Sri Lankan dealer's inventory spreadsheet.

You will receive a JSON array of rows. Each row has an id, and the raw make and model text the dealer typed.

For each row, return the canonical make and model, chosen ONLY from the allowed list supplied in the user message.

Rules:
- Return a value ONLY if you are confident the dealer meant that exact vehicle.
- If the make is not in the allowed list, return null for both fields. Do not substitute a similar brand.
- If the make is clear but the model is not in that make's allowed list, return the make and null for the model.
- Never invent a make or model. Never return a value that is not in the allowed list, even if you believe it exists.
- Ignore trim levels, grades and years in the text ("Corolla Axio G Grade 2015" is model "Axio" if Axio is allowed, otherwise "Corolla" if that is allowed).

Respond with JSON only, in this exact shape:
{"rows":[{"id":1,"make":"Toyota","model":"Corolla"},{"id":2,"make":null,"model":null}]}`;

/** What the model sees for one row. Raw text only — no prices, no invented context. */
type PromptRow = {
  id: number;
  make: string;
  model: string;
};

/**
 * Builds the user payload: the rows to repair plus the makes and models they
 * are allowed to resolve to.
 *
 * The allowed list is scoped to *candidate* makes rather than the whole
 * dictionary. Sending 30 makes and 137 models on every call would be wasteful,
 * but more importantly a long list invites the model to pattern-match against
 * something unrelated. Here it sees the handful of makes plausibly near what
 * the dealer typed, and the models under them.
 */
export function buildUserPayload(
  rows: NormalizedRow[],
  dictionary: DictionarySnapshot,
  allowedMakes: readonly string[],
  modelsByMake: ReadonlyMap<string, readonly string[]>,
): string {
  void dictionary;

  const promptRows: PromptRow[] = rows.map((row) => ({
    id: row.rowNumber,
    make: (row.raw['make'] ?? '').slice(0, 60),
    model: (row.raw['model'] ?? '').slice(0, 60),
  }));

  return JSON.stringify({
    allowed: {
      makes: allowedMakes,
      models: Object.fromEntries(modelsByMake),
    },
    rows: promptRows,
  });
}

/** One repaired row, after parsing but before whitelist validation. */
export type GroqRepair = {
  id: number;
  make: string | null;
  model: string | null;
};

/**
 * Reads the model's response into a typed shape, discarding anything malformed.
 *
 * Tolerant by design: a single bad entry drops that row's repair rather than
 * failing the batch, because the rows still carry their deterministic values
 * and are no worse off than if Groq had been unreachable.
 */
export function parseRepairs(parsed: unknown): GroqRepair[] {
  const rows = (parsed as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) return [];

  const repairs: GroqRepair[] = [];

  for (const entry of rows) {
    if (!entry || typeof entry !== 'object') continue;

    const { id, make, model } = entry as Record<string, unknown>;
    if (typeof id !== 'number' || !Number.isInteger(id)) continue;

    repairs.push({
      make: typeof make === 'string' && make.trim() ? make.trim() : null,
      model: typeof model === 'string' && model.trim() ? model.trim() : null,
      id,
    });
  }

  return repairs;
}
