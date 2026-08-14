/**
 * Shared types for the deterministic natural-language parser.
 *
 * The whole parser is built around one mutable token array. Each stage walks
 * it, claims the tokens it understands by setting `role`, and leaves the rest
 * alone. Whatever is still `unconsumed` after the last stage becomes
 * semanticText (Stage 5) — the text handed to the embedding model.
 *
 * Nothing is ever removed from the array. Stages mask tokens instead of
 * deleting them, because `index` adjacency is load-bearing: the numeric
 * extractor reads the token *before* a number to decide whether it means
 * "under" or "over", and the fuzzy matcher refuses to touch anything sitting
 * next to a digit. Splice one token out and both of those silently break.
 */

/**
 * Who claimed a token, and therefore whether it survives into semanticText.
 *
 * `unconsumed` is the only role that reaches Stage 5. `stopword` exists as a
 * distinct role rather than a boolean flag so a masked filler word can never
 * be confused with a word no stage happened to recognize — the first is
 * noise we deliberately drop, the second is signal we failed to parse and
 * must log to search_queries.unresolved_tokens.
 */
export type TokenRole =
  | 'unconsumed'
  | 'stopword'
  | 'phrase'
  | 'numeric'
  | 'make'
  | 'model'
  | 'fuel'
  | 'transmission'
  | 'vehicleType'
  | 'condition'
  | 'bodyType'
  | 'location';

export interface Token {
  /**
   * Lowercased and punctuation-stripped. Every matcher compares against this,
   * never against `raw`.
   */
  text: string;

  /**
   * The original surface form as the buyer typed it, before lowercasing and
   * punctuation stripping. Kept for logging and for error messages that
   * should echo the user's own words back to them.
   */
  raw: string;

  /**
   * Position in the token array. Stable for the lifetime of a parse — stages
   * mask tokens but never reorder or remove them, so this always matches the
   * array subscript.
   */
  index: number;

  role: TokenRole;

  /**
   * True when this token sits immediately beside a token the numeric
   * extractor consumed.
   *
   * Written in Stage 2, read in Stage 4. This is the type-gate the design
   * calls for: it stops "seater" in "5 seater" from trigram-matching some
   * unrelated make at 0.4 similarity, which would produce a confidently
   * wrong filter — strictly worse than no filter at all.
   */
  digitAdjacent: boolean;

  /**
   * Which stage claimed this token, e.g. 'stage3:make'. Observability only;
   * no logic branches on it. Makes a failing parser test readable at a glance.
   */
  consumedBy?: string;
}

/**
 * Everything one parse produces.
 *
 * `filters` is deliberately a Partial<FilterSearchDto> and not a bespoke
 * shape: the existing filter-search engine already turns that DTO into SQL,
 * handles the zero-result relaxation ladder, and builds facets. The parser's
 * entire job is to produce a valid instance of the DTO the rest of the module
 * already speaks.
 */
export interface ParseResult {
  /** Structured filters, ready to hand to FilterSearchService.search(). */
  filters: ParsedFilters;

  /**
   * Unconsumed, non-stopword tokens — the descriptive language the rules
   * could not express ("family car", "well maintained"). Empty is the normal
   * and desirable case for a well-formed query; an empty list means the
   * embedding step can be skipped entirely.
   */
  semanticText: string[];

  /**
   * Coverage-based score in [0, 1]. Stage 6 (not yet built) gates the LLM
   * repair path on this being below 0.6. Always 0 until then.
   */
  confidence: number;

  /**
   * Tokens that reached the fuzzy stage and still matched nothing. Feeds
   * search_queries.unresolved_tokens, which in turn feeds the alias-promotion
   * loop: a correction logged often enough gets promoted into
   * vehicle_dictionaries.aliases, so the next identical query resolves in the
   * exact-match path at zero cost.
   */
  unresolvedTokens: string[];

  /** The full token array, post-parse. For tests and debugging only. */
  tokens: Token[];
}

/**
 * The subset of FilterSearchDto the parser can produce.
 *
 * Structurally assignable to Partial<FilterSearchDto>, but declared
 * independently so the parser package does not have to import the DTO (and
 * with it class-validator's decorator metadata) into what are otherwise pure
 * synchronous functions. A compile-time assignability test in the parser spec
 * keeps the two in step.
 */
export interface ParsedFilters {
  vehicleType?: string[];
  make?: string[];
  model?: string[];
  condition?: string[];
  fuelType?: string[];
  transmissionType?: string[];
  color?: string[];
  locationCity?: string[];
  locationDistrict?: string[];

  minPrice?: number;
  maxPrice?: number;
  minYear?: number;
  maxYear?: number;
  minMileage?: number;
  maxMileage?: number;
  maxOwners?: number;

  isNegotiable?: boolean;

  specs?: Array<{ key: string; value: string }>;
}
