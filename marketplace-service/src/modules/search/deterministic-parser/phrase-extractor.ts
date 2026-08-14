import { Token, ParsedFilters } from './parser.types';
import { DictionaryCache, DictEntry } from '../repositories/vehicle-dictionary.repository';

/**
 * Stage 1 — multi-word phrase extraction.
 *
 * Runs before every single-token stage, and that ordering is the whole point.
 * The tokenizer splits on whitespace, so "land cruiser" arrives as two
 * tokens. Handed to Stage 3 as singles, "land" matches nothing and "cruiser"
 * either matches nothing or fuzzy-matches something wrong — the compound is
 * destroyed before anyone can recognize it. Claiming it here keeps it intact.
 *
 * Two phrase sources:
 *
 *  1. Dictionary-derived — every canonical value or alias containing a space,
 *     built at cache load ("Land Cruiser", "land cruser", "rav 4", "town
 *     ace", "Ashok Leyland", "Range Rover Evoque"). Derived from data, never
 *     hardcoded, so seeding a new multi-word model needs no code change.
 *
 *  2. Domain compounds — the closed-enum values that are multi-word in
 *     natural speech. These are NOT in vehicle_dictionaries (the entity docs
 *     are explicit that small closed enums stay as hardcoded arrays), so they
 *     have to be declared here.
 */

import {
  VEHICLE_TYPES,
  CONDITIONS,
  TRANSMISSION_TYPES,
  FUEL_TYPES,
} from '../constants/vehicle-attributes.constants';
import { KNOWN_SPEC_KEYS } from '../constants/known-spec-keys.constants';

/**
 * What a matched phrase resolves to. `field` names the ParsedFilters key it
 * feeds; `specKey` is set only when the target is a specs entry rather than a
 * column.
 */
interface PhraseTarget {
  field: 'vehicleType' | 'condition' | 'transmissionType' | 'fuelType' | 'spec';
  value: string;
  specKey?: string;
}

/**
 * Picks a value out of a constants array by its own name.
 *
 * Positional indexing (VEHICLE_TYPES[6]) would compile fine and silently
 * change meaning if anyone reordered the constant. This looks the value up by
 * identity and throws at module load — not at request time — if it is gone,
 * so a migration that drops or renames an enum value fails the build here
 * rather than producing a filter the CHECK constraint rejects at runtime.
 */
function enumValue<T extends readonly string[]>(values: T, wanted: T[number]): T[number] {
  const found = values.find((v) => v === wanted);
  if (!found) {
    throw new Error(
      `Phrase extractor references "${wanted}", which is no longer a valid value ` +
        `(have: ${values.join(', ')}). Update DOMAIN_PHRASES to match the constants.`,
    );
  }
  return found;
}

/**
 * Builds a spec-targeted phrase, checked against KNOWN_SPEC_KEYS at module
 * load.
 *
 * The query builder validates spec keys and enum values against that same
 * constant and silently drops anything unrecognized. Without this check a
 * typo here ("drivetype", "4WHEEL") would produce a phrase that matches,
 * consumes its tokens, and then evaporates in the builder — a filter the user
 * asked for that quietly does nothing. Failing at load makes that impossible.
 */
function specPhrase(key: keyof typeof KNOWN_SPEC_KEYS, value: string): PhraseTarget {
  const definition = KNOWN_SPEC_KEYS[key];

  if (definition.type !== 'enum') {
    throw new Error(`Spec phrase "${key}" targets a ${definition.type} key; expected an enum.`);
  }
  if (!(definition.values as readonly string[]).includes(value)) {
    throw new Error(
      `Spec phrase "${key}" references value "${value}", which is not in KNOWN_SPEC_KEYS ` +
        `(have: ${definition.values.join(', ')}).`,
    );
  }

  return { field: 'spec', specKey: key, value };
}

/**
 * Multi-word forms of closed-enum values.
 *
 * Every value on the right is resolved out of the constants module rather
 * than retyped, so a migration that renames an enum value breaks the build
 * here instead of silently producing a filter the CHECK constraint rejects.
 */
const DOMAIN_PHRASES: Record<string, PhraseTarget> = {
  // Vehicle types
  'three wheeler': { field: 'vehicleType', value: enumValue(VEHICLE_TYPES, 'THREE_WHEELER') },
  'three wheelers': { field: 'vehicleType', value: enumValue(VEHICLE_TYPES, 'THREE_WHEELER') },
  'tuk tuk': { field: 'vehicleType', value: enumValue(VEHICLE_TYPES, 'THREE_WHEELER') },
  'heavy machinery': { field: 'vehicleType', value: enumValue(VEHICLE_TYPES, 'HEAVY_MACHINERY') },
  // "heavy vehicle" omitted: "vehicle" is a generic stopword, so the phrase
  // is unmatchable — same trap as "plug in hybrid" above.
  'heavy equipment': { field: 'vehicleType', value: enumValue(VEHICLE_TYPES, 'HEAVY_MACHINERY') },
  'pick up': { field: 'vehicleType', value: enumValue(VEHICLE_TYPES, 'PICKUP') },

  // Condition
  'brand new': { field: 'condition', value: enumValue(CONDITIONS, 'NEW') },
  'used car': { field: 'condition', value: enumValue(CONDITIONS, 'USED') },
  'pre owned': { field: 'condition', value: enumValue(CONDITIONS, 'USED') },
  'second hand': { field: 'condition', value: enumValue(CONDITIONS, 'USED') },
  're conditioned': { field: 'condition', value: enumValue(CONDITIONS, 'RECONDITIONED') },

  // Transmission
  'semi automatic': {
    field: 'transmissionType',
    value: enumValue(TRANSMISSION_TYPES, 'SEMI_AUTOMATIC'),
  },
  'semi auto': {
    field: 'transmissionType',
    value: enumValue(TRANSMISSION_TYPES, 'SEMI_AUTOMATIC'),
  },
  'auto transmission': {
    field: 'transmissionType',
    value: enumValue(TRANSMISSION_TYPES, 'AUTOMATIC'),
  },
  'automatic transmission': {
    field: 'transmissionType',
    value: enumValue(TRANSMISSION_TYPES, 'AUTOMATIC'),
  },
  'manual transmission': {
    field: 'transmissionType',
    value: enumValue(TRANSMISSION_TYPES, 'MANUAL'),
  },

  // Fuel
  'petrol hybrid': { field: 'fuelType', value: enumValue(FUEL_TYPES, 'HYBRID') },
  // "plug in hybrid" is deliberately absent: "in" is a generic stopword, so
  // that spelling tokenizes with a masked middle token and can never match a
  // strict-adjacency phrase. "plugin" is the form that survives tokenization.
  // A spec asserts no DOMAIN_PHRASES key contains a word the tokenizer masks.
  'plugin hybrid': { field: 'fuelType', value: enumValue(FUEL_TYPES, 'HYBRID') },
  'fully electric': { field: 'fuelType', value: enumValue(FUEL_TYPES, 'ELECTRIC') },

  // Specs — drive type
  'four wheel drive': specPhrase('drive_type', '4WD'),
  'four wheel': specPhrase('drive_type', '4WD'),
  'all wheel drive': specPhrase('drive_type', 'AWD'),
  'front wheel drive': specPhrase('drive_type', 'FWD'),
  'rear wheel drive': specPhrase('drive_type', 'RWD'),

  // Specs — body type
  'station wagon': specPhrase('body_type', 'WAGON'),
  'double cab': specPhrase('body_type', 'PICKUP'),
  'single cab': specPhrase('body_type', 'PICKUP'),
  'mini van': specPhrase('body_type', 'MINIVAN'),
  'people carrier': specPhrase('body_type', 'MINIVAN'),
};

/** A candidate phrase, resolved to either a dictionary entry or a domain target. */
interface PhraseCandidate {
  words: string[];
  entry?: DictEntry;
  kind: 'make' | 'model' | 'domain';
  target?: PhraseTarget;
}

/**
 * Builds the full candidate list, sorted longest-first.
 *
 * Longest-first is required for correctness, not just efficiency: "toyota
 * land cruiser prado" must try the 3-word phrase before the 2-word one, or
 * "land cruiser" wins and "prado" is orphaned.
 */
function buildCandidates(dict: DictionaryCache): PhraseCandidate[] {
  const candidates: PhraseCandidate[] = [];

  for (const [phrase, entry] of dict.makePhrases) {
    candidates.push({ words: phrase.split(' '), entry, kind: 'make' });
  }
  for (const [phrase, entry] of dict.modelPhrases) {
    candidates.push({ words: phrase.split(' '), entry, kind: 'model' });
  }
  for (const [phrase, target] of Object.entries(DOMAIN_PHRASES)) {
    const words = phrase.split(' ');
    if (words.length < 2) continue;
    candidates.push({ words, kind: 'domain', target });
  }

  return candidates.sort((a, b) => b.words.length - a.words.length);
}

/**
 * Candidate lists are rebuilt only when the dictionary object identity
 * changes, i.e. once per cache reload rather than once per query. Keyed by
 * the cache object itself via WeakMap so a replaced cache is collectable.
 */
const candidateCache = new WeakMap<DictionaryCache, PhraseCandidate[]>();

function getCandidates(dict: DictionaryCache): PhraseCandidate[] {
  let candidates = candidateCache.get(dict);
  if (!candidates) {
    candidates = buildCandidates(dict);
    candidateCache.set(dict, candidates);
  }
  return candidates;
}

/**
 * Does `candidate` match the token run starting at `start`?
 *
 * Requires strict adjacency and that every token in the run is still
 * unclaimed. Stopword-masked tokens block a match rather than being skipped:
 * "land the cruiser" is not a Land Cruiser, and treating it as one would let
 * arbitrary filler bridge two unrelated words into a false compound.
 */
function matchesAt(tokens: Token[], start: number, candidate: PhraseCandidate): boolean {
  const { words } = candidate;
  if (start + words.length > tokens.length) return false;

  for (let offset = 0; offset < words.length; offset += 1) {
    const token = tokens[start + offset];
    if (token.role !== 'unconsumed') return false;
    if (token.text !== words[offset]) return false;
  }
  return true;
}

function addUnique(filters: ParsedFilters, key: 'vehicleType' | 'condition' | 'transmissionType' | 'fuelType' | 'make' | 'model', value: string): void {
  const list = filters[key] ?? [];
  if (!list.includes(value)) list.push(value);
  filters[key] = list;
}

function addSpec(filters: ParsedFilters, key: string, value: string): void {
  const specs = filters.specs ?? [];
  if (!specs.some((s) => s.key === key && s.value === value)) {
    specs.push({ key, value });
  }
  filters.specs = specs;
}

/**
 * Applies a matched candidate to the filter set and marks its tokens claimed.
 *
 * Every token in the run gets `role: 'phrase'` so no later stage can reclaim
 * a word that has already been absorbed into a compound — the guard that
 * stops "cruiser" from being fuzzy-matched separately after "land cruiser"
 * has already resolved.
 */
function consume(
  tokens: Token[],
  start: number,
  candidate: PhraseCandidate,
  filters: ParsedFilters,
): void {
  for (let offset = 0; offset < candidate.words.length; offset += 1) {
    const token = tokens[start + offset];
    token.role = 'phrase';
    token.consumedBy = `stage1:${candidate.kind}`;
  }

  if (candidate.kind === 'make' && candidate.entry) {
    addUnique(filters, 'make', candidate.entry.canonicalValue);
    return;
  }

  if (candidate.kind === 'model' && candidate.entry) {
    addUnique(filters, 'model', candidate.entry.canonicalValue);
    return;
  }

  const target = candidate.target;
  if (!target) return;

  if (target.field === 'spec' && target.specKey) {
    addSpec(filters, target.specKey, target.value);
  } else if (target.field !== 'spec') {
    addUnique(filters, target.field, target.value);
  }
}

/**
 * Extracts every multi-word phrase from the token array, mutating both the
 * tokens and the filter set in place.
 *
 * Scans left to right; at each position tries candidates longest-first and
 * takes the first match, then jumps past the consumed run. This is the
 * standard longest-match-wins tokenizer discipline and it makes the result
 * independent of candidate insertion order.
 */
export function extractPhrases(
  tokens: Token[],
  dict: DictionaryCache,
  filters: ParsedFilters,
): void {
  const candidates = getCandidates(dict);
  if (candidates.length === 0) return;

  let position = 0;
  while (position < tokens.length) {
    if (tokens[position].role !== 'unconsumed') {
      position += 1;
      continue;
    }

    const match = candidates.find((candidate) => matchesAt(tokens, position, candidate));

    if (match) {
      consume(tokens, position, match, filters);
      position += match.words.length;
    } else {
      position += 1;
    }
  }
}

/** Exported for tests — the hardcoded compound list is worth asserting on. */
export { DOMAIN_PHRASES };
