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

const BARE_QUERY_EXPANSIONS: Record<string, string> = {
  'family friendly': 'family friendly vehicles',
};

function expandBareQuery(q: string): string {
  const expansion = BARE_QUERY_EXPANSIONS[q.trim().toLowerCase()];
  return expansion ?? q;
}

@Injectable()
export class NlSearchService {
  constructor(
    private readonly dictionaries: VehicleDictionaryRepository,
    private readonly groqFallback: GroqFallbackService,
    private readonly embeddings: QueryEmbeddingService,
    private readonly filterSearch: FilterSearchService,
  ) {}

  async search(dto: NlSearchDto): Promise<NlSearchResponseDto> {
    const q = expandBareQuery(dto.q);
    const vocab = await this.dictionaries.getParserVocabulary();
    const rules = parseQuery(q, vocab);
    const { parsed, usedLlm } = await this.groqFallback.repair(q, rules, vocab);

    const queryEmbedding = parsed.semanticText
      ? await this.embeddings.embedQuery(parsed.semanticText)
      : null;
    const { rank, usedSemanticRanking, usedTrigramFallback } = chooseSearchRank({
      filters: parsed.filters,
      semanticText: parsed.semanticText,
      rawQuery: q,
      queryEmbedding,
    });

    const results = await this.filterSearch.search(
      toFilterSearchDto(parsed, dto),
      {
        rawText: q,
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
