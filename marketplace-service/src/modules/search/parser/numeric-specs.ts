import { isNumericToken } from './tokenize';
import { KNOWN_SPEC_KEYS } from '../constants/known-spec-keys.constants';
import type { ExtractedFilters, ParserToken } from './types';

/**
 * Stage 2a — numeric spec phrases ("7 seat", "4 doors", "6 airbags").
 *
 * Runs BEFORE extractNumeric. Without it a bare "7" reaches the generic
 * numeric stage, which has no notion of seat counts: it is below the
 * 100,000 price floor and outside the 1980–2100 year window, so classify()
 * returns undefined, the token stays unconsumed, and "7 seat" silently
 * becomes semantic text instead of a filter. Claiming the number here also
 * keeps it out of the price/mileage heuristics entirely.
 *
 * Only int-typed keys in KNOWN_SPEC_KEYS are eligible, and the value must
 * fall inside that key's declared min/max — "60 seats" is a bus, "600" is a
 * typo, and admitting the latter would return nothing while consuming the
 * token that might otherwise have matched something useful.
 */

/** Noun (and its plural/adjacent forms) → the spec key it denotes. */
const SPEC_NOUNS: Record<string, string> = {
  seat: 'seats',
  seats: 'seats',
  seater: 'seats',
  seaters: 'seats',
  door: 'doors',
  doors: 'doors',
  airbag: 'airbags',
  airbags: 'airbags',
};

type IntSpecDef = { type: 'int'; min: number; max: number };

function intSpecDef(key: string): IntSpecDef | undefined {
  const def = (KNOWN_SPEC_KEYS as Record<string, { type: string }>)[key];
  return def && def.type === 'int' ? (def as IntSpecDef) : undefined;
}

/**
 * Bare integer, deliberately narrower than parseMagnitude: a unit suffix
 * ("7k", "150cc") means the number is a quantity of something else, never a
 * seat count.
 */
function bareInt(norm: string): number | undefined {
  if (!/^\d+$/.test(norm)) return undefined;
  return Number(norm);
}

/**
 * "7-seater" as a single token.
 *
 * The tokenizer keeps hyphens (they matter for trims like "CR-V"), so the
 * compound never splits into number + noun and the two-token path below
 * cannot see it.
 */
function compoundHit(norm: string): { key: string; amount: number } | undefined {
  const match = norm.match(/^(\d+)-([a-z]+)$/);
  if (!match) return undefined;
  const key = SPEC_NOUNS[match[2]];
  if (!key) return undefined;
  return { key, amount: Number(match[1]) };
}

export function extractNumericSpecs(
  tokens: ParserToken[],
  filters: ExtractedFilters,
): void {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.consumed) continue;

    const compound = compoundHit(token.norm);
    if (compound) {
      const def = intSpecDef(compound.key);
      if (def && compound.amount >= def.min && compound.amount <= def.max) {
        addSpec(filters, compound.key, String(compound.amount));
        token.consumed = true;
      }
      continue;
    }

    if (!isNumericToken(token.norm)) continue;

    const amount = bareInt(token.norm);
    if (amount === undefined) continue;

    // Look ahead past stopwords so "7 of seats" and the hyphen-split
    // "7 seater" both resolve; the tokenizer has already split "7-seater".
    let nounIndex = -1;
    for (let j = i + 1; j < tokens.length; j++) {
      const candidate = tokens[j];
      if (candidate.consumed) break;
      if (candidate.stopword) continue;
      if (SPEC_NOUNS[candidate.norm]) nounIndex = j;
      break;
    }
    if (nounIndex === -1) continue;

    const key = SPEC_NOUNS[tokens[nounIndex].norm];
    const def = intSpecDef(key);
    if (!def) continue;
    if (amount < def.min || amount > def.max) continue;

    addSpec(filters, key, String(amount));
    token.consumed = true;
    tokens[nounIndex].consumed = true;
  }
}

function addSpec(filters: ExtractedFilters, key: string, value: string): void {
  const specs = filters.specs ?? [];
  if (specs.some((s) => s.key === key && s.value === value)) return;
  specs.push({ key, value });
  filters.specs = specs;
}
