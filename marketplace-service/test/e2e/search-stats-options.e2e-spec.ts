import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { SearchModule } from '../../src/modules/search/search.module';
import { VehicleSearchRepository } from '../../src/modules/search/repositories/vehicle-search.repository';
import { VehicleDictionaryRepository } from '../../src/modules/search/repositories/vehicle-dictionary.repository';

const dataSourceQuery = jest.fn();

// Unlike the other e2e specs, /search/stats and /search/options go straight
// through SearchOptionsService's own DataSource.query calls (not through
// VehicleSearchRepository), so this stub's return value is what these tests
// actually control.
@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: { query: dataSourceQuery } }],
  exports: [getDataSourceToken()],
})
class StubDataSourceModule {}

describe('GET /search/stats and GET /search/options (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), StubDataSourceModule, SearchModule],
    })
      .overrideProvider(VehicleSearchRepository)
      .useValue({ count: jest.fn(), search: jest.fn(), facets: jest.fn(), findById: jest.fn() })
      .overrideProvider(VehicleDictionaryRepository)
      .useValue({ getParserVocabulary: jest.fn().mockResolvedValue({ makes: [], models: [], bodyTypes: [] }) })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  beforeEach(() => dataSourceQuery.mockReset());

  afterAll(async () => {
    await app.close();
  });

  describe('GET /search/stats', () => {
    it('returns landing-page headline figures computed from live inventory', async () => {
      dataSourceQuery.mockImplementation((sql: string) => {
        if (sql.includes('vehicle_count')) {
          return Promise.resolve([
            { vehicle_count: '120', dealer_count: '8', make_count: '6', verified_dealer_count: '5' },
          ]);
        }
        if (sql.includes('GROUP BY vehicle_type')) {
          return Promise.resolve([{ vehicle_type: 'CAR', count: '90' }]);
        }
        if (sql.includes('GROUP BY make')) {
          return Promise.resolve([{ make: 'Toyota', count: '40' }]);
        }
        return Promise.resolve([]);
      });

      const res = await request(app.getHttpServer()).get('/search/stats').expect(200);

      expect(res.body).toEqual({
        vehicleCount: 120,
        dealerCount: 8,
        verifiedDealerCount: 5,
        makeCount: 6,
        categories: [{ vehicleType: 'CAR', count: 90 }],
        topMakes: [{ make: 'Toyota', count: 40 }],
      });
    });

    it('takes no query parameters and never 400s regardless of what is passed (no DTO on this route)', async () => {
      dataSourceQuery.mockResolvedValue([]);
      await request(app.getHttpServer()).get('/search/stats').expect(200);
    });
  });

  describe('GET /search/options', () => {
    it('returns dropdown options including makes with nested models', async () => {
      dataSourceQuery.mockImplementation((sql: string) => {
        if (sql.includes("dictionary_type = 'MAKE'")) {
          return Promise.resolve([{ id: 'm1', parent_id: null, canonical_value: 'Toyota' }]);
        }
        if (sql.includes("dictionary_type = 'MODEL'")) {
          return Promise.resolve([{ id: 'md1', parent_id: 'm1', canonical_value: 'Aqua' }]);
        }
        return Promise.resolve([]); // districts
      });

      const res = await request(app.getHttpServer()).get('/search/options').expect(200);

      expect(res.body.makes).toEqual([
        { id: 'm1', name: 'Toyota', models: [{ id: 'md1', name: 'Aqua' }] },
      ]);
      expect(res.body.vehicleTypes).toEqual(expect.arrayContaining(['CAR']));
    });

    it('scopes the make list to vehicleType when provided as a query param', async () => {
      dataSourceQuery.mockResolvedValue([]);

      await request(app.getHttpServer()).get('/search/options').query({ vehicleType: 'BIKE' }).expect(200);

      const makeCall = dataSourceQuery.mock.calls.find(([sql]) => sql.includes("dictionary_type = 'MAKE'"));
      expect(makeCall?.[0]).toContain('vehicle_types @> $1::text[]');
      expect(makeCall?.[1]).toEqual([['BIKE']]);
    });
  });
});
