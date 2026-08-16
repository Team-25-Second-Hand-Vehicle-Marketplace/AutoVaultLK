import { Injectable } from '@nestjs/common';
import { FilterSearchDto } from '../dto/filter-search.dto';
import { NlSearchDto } from '../dto/nl-search.dto';
import { NlSearchResponseDto } from '../dto/nl-search-response.dto';
import { parseQuery } from '../parser/deterministic-parser';
import type { ParsedQuery } from '../parser/types';
import { GroqFallbackService } from '../groq/groq-fallback.service';
import { chooseSearchRank } from '../filters/search-rank';
import { VehicleDictionaryRepository } from '../repositories/vehicle-dictionary.repository';
import { FilterSearchService } from './filter-search.service';
import { QueryEmbeddingService } from './query-embedding.service';

/**
 * SAD 4.1.4: parse → Groq repair → MiniLM rank leftovers → filter search.
 * pg_trgm is last-resort only (FR-24): rank leftovers among resolved
 * filters when MiniLM is down; gate on search_text only when nothing resolved.
 */
@Injectable()
export class NlSearchService {
  constructor(
    private readonly dictionaries: VehicleDictionaryRepository,
    private readonly groqFallback: GroqFallbackService,
    private readonly embeddings: QueryEmbeddingService,
    private readonly filterSearch: FilterSearchService,
  ) {}

  async search(dto: NlSearchDto): Promise<NlSearchResponseDto> {
    const vocab = await this.dictionaries.getParserVocabulary();
    const rules = parseQuery(dto.q, vocab);
    const { parsed, usedLlm } = await this.groqFallback.repair(dto.q, rules, vocab);

    const queryEmbedding = parsed.semanticText
      ? await this.embeddings.embedQuery(parsed.semanticText)
      : null;
    const { rank, usedSemanticRanking, usedTrigramFallback } = chooseSearchRank({
      filters: parsed.filters,
      semanticText: parsed.semanticText,
      rawQuery: dto.q,
      queryEmbedding,
    });

    const results = await this.filterSearch.search(
      toFilterSearchDto(parsed, dto),
      {
        rawText: dto.q,
        confidence: rules.confidence,
        unresolvedTokens: rules.unresolvedTokens,
        usedLlm,
      },
      rank,
    );

    return {
      ...results,
      parse: {
        confidence: parsed.confidence,
        needsGroqFallback: parsed.needsGroqFallback,
        usedGroqFallback: usedLlm,
        usedSemanticRanking,
        usedTrigramFallback,
        unresolvedTokens: parsed.unresolvedTokens,
        semanticText: parsed.semanticText,
      },
    };
  }
}

export function toFilterSearchDto(parsed: ParsedQuery, control: NlSearchDto): FilterSearchDto {
  return {
    ...parsed.filters,
    page: control.page,
    limit: control.limit,
    sort: control.sort,
    facets: control.facets,
  };
}
