import { NlSearchService, toFilterSearchDto } from './nl-search.service';
import { FilterSearchService } from './filter-search.service';
import { QueryEmbeddingService } from './query-embedding.service';
import { GroqFallbackService } from '../groq/groq-fallback.service';
import { VehicleDictionaryRepository } from '../repositories/vehicle-dictionary.repository';
import { FIXTURE_VOCABULARY } from '../parser/fixture-vocabulary';
import type { ParsedQuery } from '../parser/types';
import { FilterSearchResponseDto } from '../dto/filter-search-response.dto';
import { EMBEDDING_DIMENSIONS } from '../../../shared/normalize-embed';

function parsed(overrides: Partial<ParsedQuery> = {}): ParsedQuery {
  return {
    filters: { make: ['Toyota'] },
    semanticText: '',
    unresolvedTokens: [],
    confidence: 1,
    needsGroqFallback: false,
    consumedCount: 1,
    meaningfulCount: 1,
    ...overrides,
  };
}

function fakeEmbedding(): number[] {
  const values = new Array(EMBEDDING_DIMENSIONS).fill(0);
  values[0] = 1;
  return values;
}

describe('toFilterSearchDto', () => {
  it('copies extracted filters onto the existing FilterSearchDto shape', () => {
    const dto = toFilterSearchDto(
      parsed({
        filters: {
          make: ['Toyota'],
          model: ['Corolla'],
          maxPrice: 8_500_000,
          fuelType: ['DIESEL'],
        },
      }),
      { q: 'ignored by mapper' },
    );

    expect(dto.make).toEqual(['Toyota']);
    expect(dto.model).toEqual(['Corolla']);
    expect(dto.maxPrice).toBe(8_500_000);
    expect(dto.fuelType).toEqual(['DIESEL']);
    expect(dto.q).toBeUndefined();
  });

  it('does not put semanticText into `q` when vector ranking will run', () => {
    const dto = toFilterSearchDto(parsed({ semanticText: 'red', unresolvedTokens: ['red'] }), {
      q: 'red toyota',
    });
    expect(dto.q).toBeUndefined();
  });

  it('uses leftover semanticText as keyword `q` only when MiniLM is unavailable', () => {
    const dto = toFilterSearchDto(
      parsed({ semanticText: 'red', unresolvedTokens: ['red'] }),
      { q: 'red toyota' },
      { keywordFallback: true },
    );
    expect(dto.q).toBe('red');
  });

  it('forwards page/sort/facets without treating them as parse tokens', () => {
    const dto = toFilterSearchDto(parsed(), {
      q: 'toyota',
      page: 2,
      limit: 10,
      sort: 'price_asc',
      facets: true,
    });
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
    expect(dto.sort).toBe('price_asc');
    expect(dto.facets).toBe(true);
  });
});

describe('NlSearchService', () => {
  const emptyResults: FilterSearchResponseDto = {
    items: [],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
    appliedFilters: {},
  };

  function makeService(opts?: {
    repair?: GroqFallbackService['repair'];
    embedQuery?: QueryEmbeddingService['embedQuery'];
  }) {
    const dictionaries = {
      getParserVocabulary: jest.fn(async () => FIXTURE_VOCABULARY),
    };
    const filterSearch = {
      search: jest.fn(async () => emptyResults),
    };
    const repairFn = jest.fn(
      opts?.repair ??
        (async (_q: string, parsedQuery: ParsedQuery) => ({
          parsed: parsedQuery,
          usedLlm: false,
          dropped: [],
        })),
    );
    const embedQuery = jest.fn(
      opts?.embedQuery ?? (async (text: string) => (text.trim() ? fakeEmbedding() : null)),
    );
    const groqFallback = { repair: repairFn };
    const embeddings = { embedQuery };
    const service = new NlSearchService(
      dictionaries as unknown as VehicleDictionaryRepository,
      groqFallback as unknown as GroqFallbackService,
      embeddings as unknown as QueryEmbeddingService,
      filterSearch as unknown as FilterSearchService,
    );
    return { service, dictionaries, filterSearch, groqFallback, embeddings };
  }

  it('parses NL, then calls the existing filter search (not a new query builder)', async () => {
    const { service, filterSearch, groqFallback, embeddings } = makeService();

    const result = await service.search({ q: 'Toyata Corrola under 8.5m deisel auto' });

    expect(filterSearch.search).toHaveBeenCalledTimes(1);
    const [dto, log, queryEmbedding] = filterSearch.search.mock.calls[0];
    expect(dto.make).toEqual(['Toyota']);
    expect(dto.model).toEqual(['Corolla']);
    expect(dto.maxPrice).toBe(8_500_000);
    expect(dto.fuelType).toEqual(['DIESEL']);
    expect(dto.transmissionType).toEqual(['AUTOMATIC']);
    expect(dto.q).toBeUndefined();
    expect(queryEmbedding).toBeUndefined();
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    expect(log.rawText).toBe('Toyata Corrola under 8.5m deisel auto');
    expect(log.usedLlm).toBe(false);
    expect(log.confidence).toBe(1);

    expect(result.parse.confidence).toBe(1);
    expect(result.parse.needsGroqFallback).toBe(false);
    expect(result.parse.usedGroqFallback).toBe(false);
    expect(result.parse.usedSemanticRanking).toBe(false);
    expect(result.items).toEqual([]);
    expect(groqFallback.repair).toHaveBeenCalled();
  });

  it('does not ask Groq to invent filters when coverage is already high', async () => {
    const { service, groqFallback } = makeService();
    await service.search({ q: 'Toyata Corrola used 2018 8.5m 95k deisel auto' });
    const parsedArg = groqFallback.repair.mock.calls[0][1] as ParsedQuery;
    expect(parsedArg.needsGroqFallback).toBe(false);
  });

  it('ranks leftover semantic text with a query embedding instead of a keyword WHERE', async () => {
    const { service, filterSearch, embeddings } = makeService();

    const result = await service.search({ q: 'well maintained full option leather' });

    expect(embeddings.embedQuery).toHaveBeenCalled();
    expect(result.parse.usedSemanticRanking).toBe(true);
    const [dto, , queryEmbedding] = filterSearch.search.mock.calls[0];
    expect(dto.q).toBeUndefined();
    expect(queryEmbedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('falls back to keyword `q` when MiniLM cannot produce a vector', async () => {
    const { service, filterSearch } = makeService({ embedQuery: async () => null });

    const result = await service.search({ q: 'well maintained full option leather' });

    expect(result.parse.usedSemanticRanking).toBe(false);
    const [dto, , queryEmbedding] = filterSearch.search.mock.calls[0];
    expect(dto.q).toContain('leather');
    expect(queryEmbedding).toBeUndefined();
  });

  it('routes low-coverage queries through Groq and records usedLlm', async () => {
    const repair = jest.fn(async (_q: string, parsedQuery: ParsedQuery) => ({
      parsed: { ...parsedQuery, filters: { ...parsedQuery.filters, make: ['Honda'] } },
      usedLlm: true,
      dropped: [],
    }));
    const { service, filterSearch } = makeService({ repair });

    const result = await service.search({ q: 'well maintained full option leather' });

    expect(repair).toHaveBeenCalled();
    expect(result.parse.needsGroqFallback).toBe(true);
    expect(result.parse.usedGroqFallback).toBe(true);
    const [dto, log] = filterSearch.search.mock.calls[0];
    expect(dto.make).toEqual(['Honda']);
    expect(log.usedLlm).toBe(true);
    expect(log.unresolvedTokens.length).toBeGreaterThan(0);
  });

  it('still searches when Groq reports an outage', async () => {
    const { service, filterSearch } = makeService();

    const result = await service.search({ q: 'well maintained full option leather' });

    expect(result.parse.needsGroqFallback).toBe(true);
    expect(result.parse.usedGroqFallback).toBe(false);
    expect(result.parse.semanticText.length).toBeGreaterThan(0);
    const [, log] = filterSearch.search.mock.calls[0];
    expect(log.usedLlm).toBe(false);
  });
});
