import { NotFoundException } from '@nestjs/common';
import { SearchController } from './search.controller';
import { FilterSearchDto } from '../dto/filter-search.dto';

/**
 * Controller-level contract: which collaborator each route delegates to, and
 * the HTTP shape it produces.
 *
 * The routing decisions here are deliberate and easy to regress —
 * /search/facets goes straight to the repository specifically to avoid the
 * full search path, and /search/vehicles/:id must convert a null into a 404
 * rather than returning an empty body. Both are asserted below.
 */

function makeController() {
  const filterSearchService = { search: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
  const optionsService = {
    getOptions: jest.fn().mockResolvedValue({ makes: [] }),
    getStats: jest.fn().mockResolvedValue({ vehicleCount: 0 }),
  };
  const nlSearchService = {
    search: jest.fn().mockResolvedValue({ items: [], total: 0, parse: {} }),
  };
  const repository = {
    facets: jest.fn().mockResolvedValue({ make: [] }),
    findById: jest.fn().mockResolvedValue(null),
  };

  // Order must match the constructor exactly. nlSearchService was inserted
  // second when GET /search/nl landed; passing three args here silently slid
  // repository into the optionsService slot and left repository undefined,
  // which surfaced as "Cannot read properties of undefined (reading
  // 'facets')" rather than an arity error.
  const controller = new SearchController(
    filterSearchService as never,
    nlSearchService as never,
    optionsService as never,
    repository as never,
  );

  return { controller, filterSearchService, nlSearchService, optionsService, repository };
}

describe('SearchController — GET /search/filters', () => {
  it('delegates to the search service with the validated dto', async () => {
    const { controller, filterSearchService } = makeController();
    const dto: FilterSearchDto = { make: ['Toyota'], maxPrice: 5_000_000 };

    await controller.filterSearch(dto);

    expect(filterSearchService.search).toHaveBeenCalledWith(dto);
  });

  it('returns the service response untouched', async () => {
    const { controller, filterSearchService } = makeController();
    const response = { items: [{ id: 'a' }], total: 1, page: 1 };
    filterSearchService.search.mockResolvedValue(response);

    await expect(controller.filterSearch({})).resolves.toBe(response);
  });
});

describe('SearchController — GET /search/facets', () => {
  it('goes straight to the repository, bypassing the full search path', async () => {
    const { controller, repository, filterSearchService } = makeController();

    await controller.facets({ vehicleType: ['CAR'] });

    // Routing through search() would run the relaxation ladder, fetch and
    // discard a page of rows, and log an analytics row for a request the
    // buyer never made.
    expect(repository.facets).toHaveBeenCalledWith({ vehicleType: ['CAR'] });
    expect(filterSearchService.search).not.toHaveBeenCalled();
  });
});

describe('SearchController — GET /search/vehicles/:id', () => {
  const ID = '11111111-1111-4111-8111-111111111111';

  it('returns the vehicle when one is found', async () => {
    const { controller, repository } = makeController();
    const vehicle = { id: ID, make: 'Toyota' };
    repository.findById.mockResolvedValue(vehicle);

    await expect(controller.vehicleById(ID)).resolves.toBe(vehicle);
  });

  it('throws 404 when the repository returns null', async () => {
    const { controller, repository } = makeController();
    repository.findById.mockResolvedValue(null);

    await expect(controller.vehicleById(ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not distinguish a non-LIVE listing from a missing one', async () => {
    const { controller, repository } = makeController();
    // findById gates on status internally, so a DRAFT/SOLD row arrives here
    // as null. The 404 must not leak that the id exists.
    repository.findById.mockResolvedValue(null);

    await expect(controller.vehicleById(ID)).rejects.toThrow('Vehicle not found');
  });
});

describe('SearchController — GET /search/options', () => {
  it('passes the vehicle type through for type-scoped dropdowns', async () => {
    const { controller, optionsService } = makeController();

    await controller.options('BIKE');

    expect(optionsService.getOptions).toHaveBeenCalledWith('BIKE');
  });

  it('requests the unscoped option set when no type is given', async () => {
    const { controller, optionsService } = makeController();

    await controller.options(undefined);

    expect(optionsService.getOptions).toHaveBeenCalledWith(undefined);
  });
});

describe('SearchController — GET /search/stats', () => {
  it('delegates to the options service', async () => {
    const { controller, optionsService } = makeController();
    const stats = { vehicleCount: 87, dealerCount: 5 };
    optionsService.getStats.mockResolvedValue(stats);

    await expect(controller.stats()).resolves.toBe(stats);
  });
});
