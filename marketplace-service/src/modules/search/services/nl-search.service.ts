import { Injectable } from '@nestjs/common';
import { FilterSearchDto } from '../dto/filter-search.dto';
import { NlSearchDto } from '../dto/nl-search.dto';
import { NlSearchResponseDto } from '../dto/nl-search-response.dto';
import { parseQuery } from '../parser/deterministic-parser';
import type { ParsedQuery } from '../parser/types';
import { VehicleDictionaryRepository } from '../repositories/vehicle-dictionary.repository';
import { FilterSearchService } from './filter-search.service';

/**
 * SAD 4.1.4 steps 1–4 + 8 (filter half only).
 *
 * Parses the free-text query against the live dictionary snapshot, then
 * hands a FilterSearchDto to the existing filter path — same WHERE builder,
 * same relaxation ladder, same LIVE gate. Groq (step 5) and MiniLM/pgvector
 * (step 7) are later steps; leftover semanticText is passed as `q` so the
 * tsvector keyword layer can use it until embeddings land.
 */
@Injectable()
export class NlSearchService {
  constructor(
    private readonly dictionaries: VehicleDictionaryRepository,
    private readonly filterSearch: FilterSearchService,
  ) {}

  async search(dto: NlSearchDto): Promise<NlSearchResponseDto> {
    const vocab = await this.dictionaries.getParserVocabulary();
    const parsed = parseQuery(dto.q, vocab);
    const filterDto = toFilterSearchDto(parsed, dto);

    const results = await this.filterSearch.search(filterDto, {
      rawText: dto.q,
      confidence: parsed.confidence,
      unresolvedTokens: parsed.unresolvedTokens,
      usedLlm: false,
    });

    return {
      ...results,
      parse: {
        confidence: parsed.confidence,
        needsGroqFallback: parsed.needsGroqFallback,
        unresolvedTokens: parsed.unresolvedTokens,
        semanticText: parsed.semanticText,
      },
    };
  }
}

export function toFilterSearchDto(parsed: ParsedQuery, control: NlSearchDto): FilterSearchDto {
  const dto: FilterSearchDto = {
    ...parsed.filters,
    page: control.page,
    limit: control.limit,
    sort: control.sort,
    facets: control.facets,
  };
  if (parsed.semanticText.length > 0) {
    dto.q = parsed.semanticText;
  }
  return dto;
}
