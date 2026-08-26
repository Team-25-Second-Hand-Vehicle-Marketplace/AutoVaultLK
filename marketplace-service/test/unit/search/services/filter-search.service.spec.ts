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
describe('FilterSearchService — relaxation ladder', () => {
  interface Stub {
    service: FilterSearchService;
    countCalls: FilterSearchDto[];
  }

  function makeService(matches: (dto: FilterSearchDto) => boolean): Stub {
    const countCalls: FilterSearchDto[] = [];

    // count() receives the built query, which the beforeAll hook below tags
    // with the DTO that produced it — so each candidate filter set the
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
   * compiles to a property lookup on the module object — so patching the
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
