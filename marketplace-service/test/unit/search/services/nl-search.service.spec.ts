import { NlSearchService, toFilterSearchDto } from '../../../../src/modules/search/services/nl-search.service';
import { FilterSearchService } from '../../../../src/modules/search/services/filter-search.service';
import { QueryEmbeddingService } from '../../../../src/modules/search/services/query-embedding.service';
import { GroqFallbackService } from '../../../../src/modules/search/groq/groq-fallback.service';
import { VehicleDictionaryRepository } from '../../../../src/modules/search/repositories/vehicle-dictionary.repository';
import { FIXTURE_VOCABULARY } from '../../../../src/modules/search/parser/fixture-vocabulary';
import type { ParsedQuery } from '../../../../src/modules/search/parser/types';
import { FilterSearchResponseDto } from '../../../../src/modules/search/dto/filter-search-response.dto';
import { EMBEDDING_DIMENSIONS } from '../../../../src/shared/normalize-embed';

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

  it('never puts leftover semanticText into keyword `q` (trigram/vector own that)', () => {
    const dto = toFilterSearchDto(parsed({ semanticText: 'red', unresolvedTokens: ['red'] }), {
      q: 'red toyota',
    });
    expect(dto.q).toBeUndefined();
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
    const [dto, log, rank] = filterSearch.search.mock.calls[0];
    expect(dto.make).toEqual(['Toyota']);
    expect(dto.model).toEqual(['Corolla']);
    expect(dto.maxPrice).toBe(8_500_000);
    expect(dto.fuelType).toEqual(['DIESEL']);
    expect(dto.transmissionType).toEqual(['AUTOMATIC']);
    expect(dto.q).toBeUndefined();
    expect(rank).toBeUndefined();
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    expect(log.rawText).toBe('Toyata Corrola under 8.5m deisel auto');
    expect(log.usedLlm).toBe(false);
    expect(log.confidence).toBe(1);

    expect(result.parse.confidence).toBe(1);
    expect(result.parse.needsGroqFallback).toBe(false);
    expect(result.parse.usedGroqFallback).toBe(false);
    expect(result.parse.usedSemanticRanking).toBe(false);
    expect(result.parse.usedTrigramFallback).toBe(false);
    expect(result.items).toEqual([]);
    expect(groqFallback.repair).toHaveBeenCalled();
  });

  it('expands bare "family friendly" to a noun-anchored phrase before parsing', async () => {
    const { service, groqFallback, embeddings } = makeService();

    await service.search({ q: 'family friendly' });

    expect(groqFallback.repair).toHaveBeenCalledWith(
      'family friendly vehicles',
      expect.anything(),
      expect.anything(),
    );
    expect(embeddings.embedQuery).toHaveBeenCalledWith('family friendly vehicles');
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
    expect(result.parse.usedTrigramFallback).toBe(false);
    const [dto, , rank] = filterSearch.search.mock.calls[0];
    expect(dto.q).toBeUndefined();
    expect(rank.queryEmbedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(rank.trigramQuery).toBeUndefined();
  });

  it('ranks leftovers with pg_trgm among resolved filters when MiniLM is down', async () => {
    const { service, filterSearch } = makeService({ embedQuery: async () => null });

    const result = await service.search({ q: 'toyota leather' });

    expect(result.parse.usedSemanticRanking).toBe(false);
    expect(result.parse.usedTrigramFallback).toBe(true);
    const [dto, , rank] = filterSearch.search.mock.calls[0];
    expect(dto.make).toEqual(['Toyota']);
    expect(dto.q).toBeUndefined();
    expect(rank.trigramQuery).toContain('leather');
    expect(rank.trigramWhere).toBeUndefined();
  });

  it('gates last-resort retrieval on search_text when nothing resolved and MiniLM is down', async () => {
    const { service, filterSearch } = makeService({ embedQuery: async () => null });

    const result = await service.search({ q: 'well maintained full option leather' });

    expect(result.parse.usedTrigramFallback).toBe(true);
    const [dto, , rank] = filterSearch.search.mock.calls[0];
    expect(dto.q).toBeUndefined();
    expect(rank.trigramWhere).toBe(true);
    expect(rank.trigramQuery).toContain('leather');
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
