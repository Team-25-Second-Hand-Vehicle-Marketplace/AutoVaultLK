import { Injectable } from '@nestjs/common';
import { FilterSearchDto } from '../dto/filter-search.dto';
import { NlSearchDto } from '../dto/nl-search.dto';
import { NlSearchResponseDto } from '../dto/nl-search-response.dto';
import { parseQuery } from '../parser/deterministic-parser';
import type { ParsedQuery } from '../parser/types';
import { GroqFallbackService } from '../groq/groq-fallback.service';
import { VehicleDictionaryRepository } from '../repositories/vehicle-dictionary.repository';
import { FilterSearchService } from './filter-search.service';
import { QueryEmbeddingService } from './query-embedding.service';

/**
 * SAD 4.1.4 steps 1–8 except trigram last-resort.
 *
 * Parses, optionally Groq-repairs, embeds leftover semanticText with MiniLM,
 * then runs the existing filter path with pgvector ranking when a vector
 * is available (FR-23). No leftover text → skip embed (NFR-12.1). MiniLM
 * failure → tsvector keyword fallback (FR-24).
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
    const usedSemanticRanking = queryEmbedding !== null;
    const filterDto = toFilterSearchDto(parsed, dto, {
      keywordFallback: parsed.semanticText.length > 0 && !usedSemanticRanking,
    });

    const results = await this.filterSearch.search(
      filterDto,
      {
        rawText: dto.q,
        confidence: rules.confidence,
        unresolvedTokens: rules.unresolvedTokens,
        usedLlm,
      },
      queryEmbedding ?? undefined,
    );

    return {
      ...results,
      parse: {
        confidence: parsed.confidence,
        needsGroqFallback: parsed.needsGroqFallback,
        usedGroqFallback: usedLlm,
        usedSemanticRanking,
        unresolvedTokens: parsed.unresolvedTokens,
        semanticText: parsed.semanticText,
      },
    };
  }
}

export function toFilterSearchDto(
  parsed: ParsedQuery,
  control: NlSearchDto,
  options?: { keywordFallback?: boolean },
): FilterSearchDto {
  const dto: FilterSearchDto = {
    ...parsed.filters,
    page: control.page,
    limit: control.limit,
    sort: control.sort,
    facets: control.facets,
  };
  if (options?.keywordFallback && parsed.semanticText.length > 0) {
    dto.q = parsed.semanticText;
  }
  return dto;
}
