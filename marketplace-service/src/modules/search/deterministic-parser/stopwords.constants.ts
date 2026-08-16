/**
 * Two classes of low-content word, kept strictly apart.
 *
 * The distinction is not stylistic. GENERIC_STOPWORDS get masked in Stage 0
 * and never carry meaning. DOMAIN_OPERATORS look like stopwords but are the
 * only thing that tells the numeric extractor which direction a range points:
 * drop "under" from "under 5 million" and 5000000 becomes an unanchored
 * number with no way to know it was a ceiling. They stay `unconsumed` through
 * tokenization so Stage 2 can read them, and Stage 2 masks them itself once
 * it has.
 */

/**
 * English filler with zero domain signal. Safe to mask on sight.
 *
 * Deliberately excludes anything that could be a make, model, colour, or
 * body type. "Mini" is a make. "Land" is half of "Land Cruiser". Keep this
 * list to words that cannot possibly be vehicle vocabulary.
 */
export const GENERIC_STOPWORDS = new Set<string>([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'am',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'and',
  'or',
  'but',
  'if',
  'as',
  'of',
  'at',
  'by',
  'in',
  'on',
  'for',
  'with',
  'want',
  'wanted',
  'need',
  'needed',
  'looking',
  'look',
  'searching',
  'search',
  'find',
  'show',
  'give',
  'get',
  'please',
  'some',
  'any',
  'anything',
  'something',
  'buy',
  'buying',
  'sale',
  'selling',
  'vehicle',
  'vehicles',
]);

/**
 * Range and comparison operators.
 *
 * Stage 2 reads these to decide minPrice vs maxPrice vs both, then masks
 * whichever ones it actually consumed. Any left over after Stage 2 are masked
 * as stopwords by the orchestrator — an operator with no number attached
 * ("show me cheap cars under") carries nothing on its own and must not reach
 * semanticText, where it would only add noise to the embedding.
 *
 * Multi-word operators ("less than", "up to") are matched as phrases by the
 * numeric extractor's own lookbehind, not here; this set holds the individual
 * tokens so masking can be done token by token.
 */
export const DOMAIN_OPERATORS = new Set<string>([
  'under',
  'below',
  'less',
  'lesser',
  'than',
  'upto',
  'up',
  'max',
  'maximum',
  'within',
  'atmost',
  'over',
  'above',
  'more',
  'greater',
  'min',
  'minimum',
  'atleast',
  'least',
  'from',
  'starting',
  'between',
  // The range connector, and the canonical form the tokenizer rewrites
  // "2015-2018" into. It reads like generic filler, but masking it would
  // leave Stage 2 with two bare years and no way to tell a range from two
  // unrelated numbers — so it is an operator, not a stopword.
  'to',
  'range',
  'around',
  'approx',
  'approximately',
  'about',
  'near',
  'roughly',
  'nearly',
]);

/**
 * True for words that carry no signal on their own and should be masked
 * during tokenization. Domain operators are excluded on purpose — masking
 * them here would destroy Stage 2's ability to read range direction.
 */
export function isGenericStopword(text: string): boolean {
  return GENERIC_STOPWORDS.has(text);
}

export function isDomainOperator(text: string): boolean {
  return DOMAIN_OPERATORS.has(text);
}
