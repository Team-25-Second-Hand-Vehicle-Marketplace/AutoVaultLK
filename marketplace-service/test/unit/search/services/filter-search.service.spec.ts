import { FilterSearchService } from '../../../../src/modules/search/services/filter-search.service';
import { FilterSearchDto } from '../../../../src/modules/search/dto/filter-search.dto';
import { VehicleSearchRepository } from '../../../../src/modules/search/repositories/vehicle-search.repository';
import { DataSource } from 'typeorm';
import * as builderModuleRef from '../../../../src/modules/search/filters/filter-query.builder';

/**
 * Tests for the zero-result relaxation ladder.
 *
 * The repository and DataSource are stubbed so these stay fast unit tests:
 * what matters here is which filter set the service decides to re-count and
 * what it tells the buyer it did, not what Postgres returns.
 *
 * `counts` maps a predicate over the DTO to a row count, letting each test
 * describe "nothing matches until X is relaxed" declaratively.
 */
describe('FilterSearchService - relaxation ladder', () => {
  interface Stub {
    service: FilterSearchService;
    countCalls: FilterSearchDto[];
  }

  function makeService(matches: (dto: FilterSearchDto) => boolean): Stub {
    const countCalls: FilterSearchDto[] = [];

    // count() receives the built query, which the beforeAll hook below tags
    // with the DTO that produced it - so each candidate filter set the
    // ladder considers is observable here.
    const repository = {
      count: jest.fn(async (built: unknown) => {
        const dto = (built as { __dto?: FilterSearchDto }).__dto;
        if (dto) countCalls.push(dto);
        return dto && matches(dto) ? 5 : 0;
      }),
      search: jest.fn(async () => []),
      facets: jest.fn(async () => ({})),
    };

    const service = new FilterSearchService(
      repository as unknown as VehicleSearchRepository,
      // logSearch is fire-and-forget analytics; a stub that resolves is
      // enough, and a rejection here must not fail a search.
      { query: jest.fn(async () => []) } as unknown as DataSource,
    );

    return { service, countCalls };
  }

  /**
   * The service calls buildFilterQuery(dto) and passes the result to
   * count(), so count() alone cannot tell us which candidate filter set the
   * ladder is currently evaluating. Tagging each built query with the DTO
   * that produced it makes that visible without changing production code.
   *
   * The service imports buildFilterQuery as a named import, which ts-jest
   * compiles to a property lookup on the module object - so patching the
   * module export here is seen by the service at call time.
   */
  beforeAll(() => {
    const builderModule = builderModuleRef as {
      buildFilterQuery: (dto: FilterSearchDto) => object;
    };
    const original = builderModule.buildFilterQuery;
    builderModule.buildFilterQuery = (dto: FilterSearchDto) =>
      Object.assign(original(dto), { __dto: dto });
  });

  it('reports every filter it relaxed, not only the last one', async () => {
    // Nothing matches until BOTH specs and the year range are relaxed.
    const { service } = makeService(
      (dto) => !dto.specs?.length && dto.minYear === 2014,
    );

    const result = await service.search({
      specs: [{ key: 'body_type', value: 'SUV' }],
      minYear: 2015,
    } as FilterSearchDto);

    expect(result.relaxation).toBeDefined();
    // Both steps were applied to reach a result, so both must be disclosed.
    expect(result.relaxation!.droppedFilters).toEqual(['specs', 'yearRange']);
    expect(result.relaxation!.message).toContain('vehicle spec filters');
    expect(result.relaxation!.message).toContain('year range');
  });

  it('skips steps that would not change the query', async () => {
    // Only a keyword is set, so spec/mileage/year steps are inapplicable.
    const { service } = makeService((dto) => dto.q === undefined);

    const result = await service.search({ q: 'nonexistent' } as FilterSearchDto);

    expect(result.relaxation!.droppedFilters).toEqual(['q']);
  });

  it('relaxes a keyword before widening numeric ranges', async () => {
    // Both a keyword and a year range are set; dropping the keyword alone
    // is enough, so the year range must be left untouched.
    const { service } = makeService((dto) => dto.q === undefined && dto.minYear === 2015);

    const result = await service.search({
      q: 'typoed-model',
      minYear: 2015,
    } as FilterSearchDto);

    expect(result.relaxation!.droppedFilters).toEqual(['q']);
    expect(result.relaxation!.droppedFilters).not.toContain('yearRange');
  });

  it('relaxes hasRegistrationYear before the year range', async () => {
    const { service } = makeService(
      (dto) => dto.hasRegistrationYear === undefined && dto.minYear === 2015,
    );

    const result = await service.search({
      hasRegistrationYear: true,
      minYear: 2015,
    } as FilterSearchDto);

    expect(result.relaxation!.droppedFilters).toEqual(['hasRegistrationYear']);
  });

  it('never drops a price ceiling, flagging it instead', async () => {
    const { service } = makeService((dto) => !dto.specs?.length);

    const result = await service.search({
      maxPrice: 2_000_000,
      specs: [{ key: 'body_type', value: 'SUV' }],
    } as FilterSearchDto);

    expect(result.relaxation!.droppedFilters).not.toContain('maxPrice');
    expect(result.relaxation!.priceCeilingExceeded).toBe(true);
    expect(result.relaxation!.message).toContain('exceed your budget');
  });

  it('returns an empty result rather than inventing one when nothing matches', async () => {
    const { service } = makeService(() => false);

    const result = await service.search({
      make: ['NoSuchMake'],
    } as FilterSearchDto);

    expect(result.relaxation).toBeUndefined();
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('does not relax at all when the original search has results', async () => {
    const { service } = makeService(() => true);

    const result = await service.search({ make: ['Toyota'] } as FilterSearchDto);

    expect(result.relaxation).toBeUndefined();
    expect(result.total).toBe(5);
  });
});

/**
 * Natural-language relaxation. Unlike the dropdown ladder, the descriptive
 * word is dropped first, and the semantic rank is part of what gets relaxed.
 */
describe('FilterSearchService - natural-language relaxation', () => {
  const rankWithWord = {
    queryEmbedding: [0.1, 0.2],
    embeddingWhere: false,
    maxEmbeddingDistance: 0.7,
  };

  function makeNaturalService(matches: (dto: FilterSearchDto, rank?: unknown) => boolean) {
    const repository = {
      count: jest.fn(async (built: unknown, _verified: unknown, rank?: unknown) => {
        const dto = (built as { __dto?: FilterSearchDto }).__dto;
        return dto && matches(dto, rank) ? 5 : 0;
      }),
      search: jest.fn(async () => []),
      facets: jest.fn(async () => ({})),
    };
    return new FilterSearchService(
      repository as unknown as VehicleSearchRepository,
      { query: jest.fn(async () => []) } as unknown as DataSource,
    );
  }

  beforeAll(() => {
    const builderModule = builderModuleRef as {
      buildFilterQuery: (dto: FilterSearchDto) => object;
    };
    const original = builderModule.buildFilterQuery;
    builderModule.buildFilterQuery = (dto: FilterSearchDto) =>
      Object.assign(original(dto), { __dto: dto });
  });

  it('"luxury car under 10 million": drops the descriptive word and keeps the 10M ceiling', async () => {
    const service = makeNaturalService((dto, rank) => !rank && dto.maxPrice === 10_000_000);

    const result = await service.search(
      { vehicleType: ['CAR'], maxPrice: 10_000_000 } as FilterSearchDto,
      undefined,
      rankWithWord,
      { semanticText: 'luxury' },
    );

    expect(result.total).toBe(5);
    expect(result.relaxation!.droppedFilters).toEqual(['semanticText']);
    expect(result.relaxation!.message).toContain('"luxury"');
    expect(result.relaxation!.priceCeilingExceeded).toBe(false);
  });

  it('"sporty car under 10 million": same ladder, the word goes before anything else', async () => {
    const service = makeNaturalService((dto, rank) => !rank && dto.maxPrice === 10_000_000);

    const result = await service.search(
      { vehicleType: ['CAR'], maxPrice: 10_000_000 } as FilterSearchDto,
      undefined,
      rankWithWord,
      { semanticText: 'sporty' },
    );

    expect(result.relaxation!.droppedFilters).toEqual(['semanticText']);
  });

  it('"toyota sports car under 3 million": keeps the budget and drops the make when nothing else matches', async () => {
    // Nothing Toyota-branded under 3M; without the make, cars under 3M exist.
    const service = makeNaturalService(
      (dto, rank) => !rank && dto.maxPrice === 3_000_000 && !dto.make?.length,
    );

    const result = await service.search(
      { make: ['Toyota'], vehicleType: ['CAR'], maxPrice: 3_000_000 } as FilterSearchDto,
      undefined,
      rankWithWord,
      { semanticText: 'sports' },
    );

    expect(result.relaxation!.droppedFilters).toEqual(['semanticText', 'make']);
    expect(result.relaxation!.priceCeilingExceeded).toBe(false);
  });

  it('"luxury under 1 million": raises the price ceiling only after the other filters', async () => {
    // Nothing under 1M at all; only once the ceiling reaches 1.2M does anything match.
    const service = makeNaturalService(
      (dto, rank) => !rank && dto.maxPrice !== undefined && dto.maxPrice >= 1_200_000,
    );

    const result = await service.search(
      { vehicleType: ['CAR'], maxPrice: 1_000_000 } as FilterSearchDto,
      undefined,
      rankWithWord,
      { semanticText: 'luxury' },
    );

    expect(result.relaxation!.droppedFilters).toEqual([
      'semanticText',
      'vehicleType',
      'maxPrice',
    ]);
    expect(result.relaxation!.priceCeilingExceeded).toBe(true);
  });

  it('a purely descriptive query stays empty instead of returning the whole catalogue', async () => {
    // With the semantic rank applied nothing matches; without it, everything would.
    const service = makeNaturalService((_dto, rank) => !rank);

    const result = await service.search({} as FilterSearchDto, undefined, rankWithWord, {
      semanticText: 'luxury',
    });

    expect(result.total).toBe(0);
    expect(result.relaxation).toBeUndefined();
  });

  it('a query that already has results is not relaxed', async () => {
    const service = makeNaturalService(() => true);

    const result = await service.search(
      { vehicleType: ['CAR'], maxPrice: 10_000_000 } as FilterSearchDto,
      undefined,
      rankWithWord,
      { semanticText: 'luxury' },
    );

    expect(result.relaxation).toBeUndefined();
    expect(result.total).toBe(5);
  });
});
