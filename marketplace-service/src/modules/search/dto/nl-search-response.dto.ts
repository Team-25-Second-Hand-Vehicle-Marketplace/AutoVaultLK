import type { FilterSearchResponseDto } from './filter-search-response.dto';

/**
 * Filter search payload plus the FR-21 parse metadata the UI (and later
 * Groq/MiniLM steps) need. `needsGroqFallback` is reported this step but
 * Groq is not called yet.
 */
export interface NlParseDto {
  confidence: number;
  needsGroqFallback: boolean;
  unresolvedTokens: string[];
  semanticText: string;
}

export interface NlSearchResponseDto extends FilterSearchResponseDto {
  parse: NlParseDto;
}
