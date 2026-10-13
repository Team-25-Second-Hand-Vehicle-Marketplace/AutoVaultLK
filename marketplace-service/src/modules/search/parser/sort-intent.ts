import type { SortOption } from '../constants/vehicle-attributes.constants';
import type { ExtractedFilters, ParserToken } from './types';

/**
 * Two-word intents, tried before the single-word table so "lowest mileage"
 * resolves to mileage_asc instead of stopping at "lowest" -> price_asc.
 */
const SORT_PHRASES: ReadonlyArray<{
  readonly words: readonly [string, string];
  readonly sort: SortOption;
}> = [
  { words: ['low', 'mileage'], sort: 'mileage_asc' },
  { words: ['lowest', 'mileage'], sort: 'mileage_asc' },
  { words: ['least', 'mileage'], sort: 'mileage_asc' },
  { words: ['lowest', 'price'], sort: 'price_asc' },
  { words: ['cheapest', 'price'], sort: 'price_asc' },
  { words: ['least', 'expensive'], sort: 'price_asc' },
  { words: ['highest', 'price'], sort: 'price_desc' },
  { words: ['most', 'expensive'], sort: 'price_desc' },
];

/**
 * Words that name an ordering and nothing else. Kept deliberately narrow:
 * anything that could plausibly be a make, model or trim in the dealer
 * dictionary stays out, because this stage runs before stageExact and would
 * otherwise shadow a real dictionary hit. That rules out "premium" and
 * "luxury" (trim names), and "economical" (fuel economy, not price).
 *
 * "new" is absent on purpose - it is a condition (NEW), not an ordering.
 */
const SORT_WORDS: Readonly<Record<string, SortOption>> = {
  cheap: 'price_asc',
  cheaper: 'price_asc',
  cheapest: 'price_asc',
  affordable: 'price_asc',
  inexpensive: 'price_asc',
  budget: 'price_asc',
  lowest: 'price_asc',
  expensive: 'price_desc',
  priciest: 'price_desc',
  costliest: 'price_desc',
  newest: 'year_desc',
  latest: 'year_desc',
};

/**
 * Resolves an ordering asked for in words and consumes the tokens that said
 * so, which is the point: left unconsumed, "cheap" drags down confidence,
 * triggers a needless Groq call, and then reaches semantic ranking - where a
 * listing whose description mentions value outranks the genuinely cheapest
 * car.
 *
 * Runs after extractNumeric so an explicit bound always wins the token:
 * "cheaper than 3 million" keeps maxPrice and only then reads as price_asc,
 * whereas a bare "cheap" has no number to anchor to and becomes the sort.
 *
 * SQL has one ORDER BY, so the first intent found wins. A second ordering
 * word in the same query is left unconsumed rather than silently dropped, so
 * it surfaces in unresolvedTokens and the UI can say it was not understood.
 */
export function extractSortIntent(
  tokens: ParserToken[],
  filters: ExtractedFilters,
): void {
  if (filters.sort) return;

  // Tokens still in play. Collapsing to this list lets a phrase match across
  // an intervening stopword ("lowest of the price") without special cases.
  const open: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.consumed && !token.stopword && token.norm) open.push(i);
  }

  for (let i = 0; i + 1 < open.length; i++) {
    const first = tokens[open[i]].norm;
    const second = tokens[open[i + 1]].norm;
    const phrase = SORT_PHRASES.find(
      (candidate) =>
        candidate.words[0] === first && candidate.words[1] === second,
    );
    if (!phrase) continue;

    filters.sort = phrase.sort;
    tokens[open[i]].consumed = true;
    tokens[open[i + 1]].consumed = true;
    return;
  }

  for (const index of open) {
    const sort = SORT_WORDS[tokens[index].norm];
    if (!sort) continue;

    filters.sort = sort;
    tokens[index].consumed = true;
    return;
  }
}
