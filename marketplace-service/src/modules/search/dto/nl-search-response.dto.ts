import type { FilterSearchResponseDto } from './filter-search-response.dto';

/**
 * Filter search payload plus FR-21 parse metadata.
 * `needsGroqFallback` is the 0.6 coverage gate; `usedGroqFallback` is
 * whether Groq actually returned (false on skip, missing key, or outage).
 * `usedSemanticRanking` is whether MiniLM produced a query vector.
 */
export interface NlParseDto {
  confidence: number;
  needsGroqFallback: boolean;
  usedGroqFallback: boolean;
  usedSemanticRanking: boolean;
  unresolvedTokens: string[];
  semanticText: string;
}

export interface NlSearchResponseDto extends FilterSearchResponseDto {
  parse: NlParseDto;
}
