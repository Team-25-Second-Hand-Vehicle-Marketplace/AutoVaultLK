import { NlSearchService, toFilterSearchDto } from './nl-search.service';
import { FilterSearchService } from './filter-search.service';
import { GroqFallbackService } from '../groq/groq-fallback.service';
import { VehicleDictionaryRepository } from '../repositories/vehicle-dictionary.repository';
import { FIXTURE_VOCABULARY } from '../parser/fixture-vocabulary';
import type { ParsedQuery } from '../parser/types';
import { FilterSearchResponseDto } from '../dto/filter-search-response.dto';

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

  it('forwards leftover semanticText as the keyword `q` layer', () => {
    const dto = toFilterSearchDto(parsed({ semanticText: 'red', unresolvedTokens: ['red'] }), {
      q: 'red toyota',
    });
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

  function makeService(repair?: GroqFallbackService['repair']) {
    const dictionaries = {
      getParserVocabulary: jest.fn(async () => FIXTURE_VOCABULARY),
    };
    const filterSearch = {
      search: jest.fn(async () => emptyResults),
    };
    const repairFn = jest.fn(
      repair ??
        (async (_q: string, parsed: ParsedQuery) => ({
          parsed,
          usedLlm: false,
          dropped: [],
        })),
    );
    const groqFallback = { repair: repairFn };
    const service = new NlSearchService(
      dictionaries as unknown as VehicleDictionaryRepository,
      groqFallback as unknown as GroqFallbackService,
      filterSearch as unknown as FilterSearchService,
    );
    return { service, dictionaries, filterSearch, groqFallback };
  }

  it('parses NL, then calls the existing filter search (not a new query builder)', async () => {
    const { service, filterSearch, groqFallback } = makeService();

    const result = await service.search({ q: 'Toyata Corrola under 8.5m deisel auto' });

    expect(filterSearch.search).toHaveBeenCalledTimes(1);
    const [dto, log] = filterSearch.search.mock.calls[0];
    expect(dto.make).toEqual(['Toyota']);
    expect(dto.model).toEqual(['Corolla']);
    expect(dto.maxPrice).toBe(8_500_000);
    expect(dto.fuelType).toEqual(['DIESEL']);
    expect(dto.transmissionType).toEqual(['AUTOMATIC']);
    expect(log.rawText).toBe('Toyata Corrola under 8.5m deisel auto');
    expect(log.usedLlm).toBe(false);
    expect(log.confidence).toBe(1);

    expect(result.parse.confidence).toBe(1);
    expect(result.parse.needsGroqFallback).toBe(false);
    expect(result.parse.usedGroqFallback).toBe(false);
    expect(result.items).toEqual([]);
    expect(groqFallback.repair).toHaveBeenCalled();
  });

  it('does not ask Groq to invent filters when coverage is already high', async () => {
    const { service, groqFallback } = makeService();
    await service.search({ q: 'Toyata Corrola used 2018 8.5m 95k deisel auto' });
    const parsedArg = groqFallback.repair.mock.calls[0][1] as ParsedQuery;
    expect(parsedArg.needsGroqFallback).toBe(false);
  });

  it('routes low-coverage queries through Groq and records usedLlm', async () => {
    const repair = jest.fn(async (_q: string, parsed: ParsedQuery) => ({
      parsed: { ...parsed, filters: { ...parsed.filters, make: ['Honda'] } },
      usedLlm: true,
      dropped: [],
    }));
    const { service, filterSearch } = makeService(repair);

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
