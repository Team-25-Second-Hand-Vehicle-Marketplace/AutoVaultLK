import { Injectable } from '@nestjs/common';
import { FilterSearchDto } from '../dto/filter-search.dto';
import { NlSearchDto } from '../dto/nl-search.dto';
import { NlSearchResponseDto } from '../dto/nl-search-response.dto';
import { parseQuery } from '../parser/deterministic-parser';
import type { ParsedQuery } from '../parser/types';
import { GroqFallbackService } from '../groq/groq-fallback.service';
import { VehicleDictionaryRepository } from '../repositories/vehicle-dictionary.repository';
import { FilterSearchService } from './filter-search.service';

/**
 * SAD 4.1.4 steps 1–6 + 8 (filter half; MiniLM/pgvector still later).
 *
 * Parses against the live dictionary snapshot, optionally Groq-repairs
 * unresolved tokens when confidence < 0.6 (whitelist-validated), then
 * hands a FilterSearchDto to the existing filter path.
 */
@Injectable()
export class NlSearchService {
  constructor(
    private readonly dictionaries: VehicleDictionaryRepository,
    private readonly groqFallback: GroqFallbackService,
    private readonly filterSearch: FilterSearchService,
  ) {}

  async search(dto: NlSearchDto): Promise<NlSearchResponseDto> {
    const vocab = await this.dictionaries.getParserVocabulary();
    const rules = parseQuery(dto.q, vocab);
    const { parsed, usedLlm } = await this.groqFallback.repair(dto.q, rules, vocab);
    const filterDto = toFilterSearchDto(parsed, dto);

    const results = await this.filterSearch.search(filterDto, {
      rawText: dto.q,
      confidence: rules.confidence,
      unresolvedTokens: rules.unresolvedTokens,
      usedLlm,
    });

    return {
      ...results,
      parse: {
        confidence: parsed.confidence,
        needsGroqFallback: parsed.needsGroqFallback,
        usedGroqFallback: usedLlm,
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
