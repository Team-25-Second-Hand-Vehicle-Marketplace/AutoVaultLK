import type { FilterSearchResponseDto } from './filter-search-response.dto';


export interface NlParseDto {
  confidence: number;
  needsGroqFallback: boolean;
  usedGroqFallback: boolean;
  usedSemanticRanking: boolean;
  usedTrigramFallback: boolean;
  unresolvedTokens: string[];
  semanticText: string;
}

export interface NlSearchResponseDto extends FilterSearchResponseDto {
  parse: NlParseDto;
}
