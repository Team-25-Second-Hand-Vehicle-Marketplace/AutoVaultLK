import { SearchOptionsService } from '../../../../src/modules/search/services/search-options.service';

describe('SearchOptionsService', () => {
  const dataSource = { query: jest.fn() };
  let service: SearchOptionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SearchOptionsService(dataSource as never);
  });

  describe('getOptions', () => {
    it('returns makes with nested models grouped by parent_id', async () => {
      // getMakesWithModels() and getDistricts() run concurrently via
      // Promise.all, so the mock must dispatch on the query text rather than
      // assume a fixed call order.
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes("dictionary_type = 'MAKE'")) {
          return Promise.resolve([{ id: 'm1', parent_id: null, canonical_value: 'Toyota' }]);
        }
        if (sql.includes("dictionary_type = 'MODEL'")) {
          return Promise.resolve([{ id: 'md1', parent_id: 'm1', canonical_value: 'Aqua' }]);
        }
        return Promise.resolve([]); // districts
      });

      const options = await service.getOptions();

      expect(options.makes).toEqual([
        { id: 'm1', name: 'Toyota', models: [{ id: 'md1', name: 'Aqua' }] },
      ]);
    });

    it('scopes the make query to vehicleType via the @> array filter when provided', async () => {
      dataSource.query.mockResolvedValue([]);

      await service.getOptions('BIKE');

      const [sql, params] = dataSource.query.mock.calls[0];
      expect(sql).toContain('vehicle_types @> $1::text[]');
      expect(params).toEqual([['BIKE']]);
    });

    it('skips the model query entirely when no makes match', async () => {
      dataSource.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]); // makes, districts

      await service.getOptions();

      // only 2 calls: makes + districts, never a models query for an empty make list
      expect(dataSource.query).toHaveBeenCalledTimes(2);
    });

    it('caches the result per vehicleType and does not re-query within the TTL', async () => {
      dataSource.query.mockResolvedValue([]);

      await service.getOptions('CAR');
      const callsAfterFirst = dataSource.query.mock.calls.length;
      await service.getOptions('CAR');

      expect(dataSource.query.mock.calls.length).toBe(callsAfterFirst);
    });

    it('caches CAR and BIKE separately (cache key is scoped by vehicleType)', async () => {
      dataSource.query.mockResolvedValue([]);

      await service.getOptions('CAR');
      const callsAfterCar = dataSource.query.mock.calls.length;
      await service.getOptions('BIKE');

      expect(dataSource.query.mock.calls.length).toBeGreaterThan(callsAfterCar);
    });
  });

  describe('getStats', () => {
    // totals, categories, and topMakes all run concurrently via Promise.all,
    // so dispatch on the query text rather than assume a fixed call order.
    function mockStatsQueries(opts: {
      totals?: Record<string, string>;
      categories?: Array<{ vehicle_type: string; count: string }>;
      topMakes?: Array<{ make: string; count: string }>;
    }) {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('vehicle_count')) return Promise.resolve(opts.totals ? [opts.totals] : []);
        if (sql.includes('GROUP BY vehicle_type')) return Promise.resolve(opts.categories ?? []);
        if (sql.includes('GROUP BY make')) return Promise.resolve(opts.topMakes ?? []);
        return Promise.resolve([]);
      });
    }

    it('parses string aggregate counts into numbers', async () => {
      mockStatsQueries({
        totals: { vehicle_count: '42', dealer_count: '7', make_count: '5', verified_dealer_count: '3' },
        categories: [{ vehicle_type: 'CAR', count: '30' }],
        topMakes: [{ make: 'Toyota', count: '12' }],
      });

      const stats = await service.getStats();

      expect(stats).toEqual({
        vehicleCount: 42,
        dealerCount: 7,
        verifiedDealerCount: 3,
        makeCount: 5,
        categories: [{ vehicleType: 'CAR', count: 30 }],
        topMakes: [{ make: 'Toyota', count: 12 }],
      });
    });

    it('defaults every count to 0 when the totals row is empty', async () => {
      mockStatsQueries({});

      const stats = await service.getStats();

      expect(stats.vehicleCount).toBe(0);
      expect(stats.dealerCount).toBe(0);
      expect(stats.verifiedDealerCount).toBe(0);
      expect(stats.makeCount).toBe(0);
    });

    it('caches stats and does not re-query within the TTL', async () => {
      dataSource.query.mockResolvedValue([]);

      await service.getStats();
      const callsAfterFirst = dataSource.query.mock.calls.length;
      await service.getStats();

      expect(dataSource.query.mock.calls.length).toBe(callsAfterFirst);
    });
  });
});
