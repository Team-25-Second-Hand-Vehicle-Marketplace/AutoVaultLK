import { Token } from './parser.types';
import { isGenericStopword } from './stopwords.constants';

/**
 * Stage 0 — turn a free-text query into the token array every later stage
 * mutates.
 *
 * Four operations in a fixed order: lowercase, strip punctuation selectively,
 * split on whitespace, mask generic stopwords.
 *
 * The interesting part is "selectively". A blanket `replace(/[^\w\s]/g, '')`
 * is the obvious implementation and it corrupts real data:
 *
 *   "Rs.5,000,000" -> "rs5000000"     price digits must survive as one number
 *   "1.5L"         -> "15l"           the decimal point is meaningful
 *   "2015-2018"    -> "20152018"      a range collapses into a nonsense year
 *   "Mercedes-Benz"-> "mercedesbenz"  no longer matches the canonical value
 *
 * So punctuation is classified by what sits on either side of it rather than
 * by the character alone.
 */

/** Upper bound on input length. Anything longer is a bot or a paste accident. */
const MAX_QUERY_LENGTH = 512;

/** Upper bound on token count, applied after splitting. */
const MAX_TOKENS = 64;

/**
 * Normalizes one raw query string into cleaned, whitespace-separated text.
 *
 * Ordering inside this function matters: thousands separators must be removed
 * before the decimal-point rule runs, otherwise "5,000.50" keeps a comma that
 * the digit-dot-digit check then reads as a word boundary.
 */
function normalizeText(input: string): string {
  let text = input.toLowerCase();

  // Thousands separators between digits: "5,000,000" -> "5000000".
  // Applied repeatedly because the pattern's own lookahead consumes the digit
  // that the next match needs (a single pass leaves "5000,000").
  let previous: string;
  do {
    previous = text;
    text = text.replace(/(\d),(\d)/g, '$1$2');
  } while (text !== previous);

  // Currency and unit punctuation that hugs a number: "rs.5000" -> "rs 5000".
  // The dot here separates a word from a digit, so it is a boundary, not a
  // decimal point. This runs before the decimal rule to claim those dots first.
  text = text.replace(/([a-z])\.(\d)/g, '$1 $2');

  // Ranges: "2015-2018" and "2015–2018" (en dash) -> "2015 to 2018".
  // Rewritten to the explicit word rather than just split on, so Stage 2 sees
  // the same "X to Y" shape it already handles for typed-out ranges and needs
  // exactly one code path for both.
  text = text.replace(/(\d)\s*[-–—]\s*(\d)/g, '$1 to $2');

  // Everything else that is not a letter, digit, whitespace, or a
  // structurally meaningful separator becomes a space. Dots and hyphens are
  // spared here and filtered by the two rules below.
  text = text.replace(/[^a-z0-9\s.\-+]/g, ' ');

  // Decimal points survive only between digits ("1.5", "8.5m" once the m is
  // split off). A dot anywhere else is sentence punctuation.
  text = text.replace(/\.(?!\d)/g, ' ');
  text = text.replace(/(?<![0-9])\./g, ' ');

  // Hyphens survive only between letters, where they are part of a canonical
  // name ("mercedes-benz", "cr-v"). Digit ranges were already rewritten above,
  // so any hyphen still touching a digit is noise.
  text = text.replace(/-(?![a-z])/g, ' ');
  text = text.replace(/(?<![a-z])-/g, ' ');

  // A trailing "+" is meaningful on spec values ("250cc+") but not elsewhere.
  text = text.replace(/\+(?![\s]|$)/g, ' ');

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Splits a glued alphanumeric token into its number and unit parts.
 *
 * Buyers type "5m", "800k", "150cc", "50000km" with no space, and Stage 2's
 * lookbehind/lookahead logic works on separate tokens. Splitting here keeps
 * that logic uniform instead of making every numeric rule handle both a
 * spaced and a glued form.
 *
 * Only splits digit-then-letter. Letter-then-digit ("cr-v" after hyphen
 * removal, "x5", "c200") is left alone: those are model names, and splitting
 * them would destroy a dictionary match.
 */
function splitNumericUnit(raw: string): string[] {
  const match = /^(\d+(?:\.\d+)?)([a-z]+\+?)$/.exec(raw);
  if (!match) return [raw];
  return [match[1], match[2]];
}

/**
 * Tokenizes a query into the array the parser stages operate on.
 *
 * Generic stopwords are marked `role: 'stopword'` rather than removed —
 * see parser.types.ts for why index adjacency has to stay intact. Domain
 * operators ("under", "between") are deliberately left `unconsumed` for
 * Stage 2 to read and mask itself.
 */
export function tokenize(query: string): Token[] {
  if (typeof query !== 'string') return [];

  const normalized = normalizeText(query.slice(0, MAX_QUERY_LENGTH));
  if (normalized.length === 0) return [];

  const rawParts = normalized.split(' ').filter(Boolean);

  const expanded: string[] = [];
  for (const part of rawParts) {
    expanded.push(...splitNumericUnit(part));
    if (expanded.length >= MAX_TOKENS) break;
  }

  return expanded.slice(0, MAX_TOKENS).map((text, index) => ({
    text,
    raw: text,
    index,
    role: isGenericStopword(text) ? ('stopword' as const) : ('unconsumed' as const),
    digitAdjacent: false,
    consumedBy: isGenericStopword(text) ? 'stage0:stopword' : undefined,
  }));
}
