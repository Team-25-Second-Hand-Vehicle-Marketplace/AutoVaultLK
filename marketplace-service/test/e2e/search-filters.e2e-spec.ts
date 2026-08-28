import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { SearchModule } from '../../src/modules/search/search.module';
import { VehicleSearchRepository } from '../../src/modules/search/repositories/vehicle-search.repository';
import { VehicleDictionaryRepository } from '../../src/modules/search/repositories/vehicle-dictionary.repository';
import { VehicleSearchResultDto } from '../../src/modules/search/dto/filter-search-response.dto';

// SearchModule has no DataSource provider of its own — it comes from
// AppModule's TypeOrmModule.forRoot() in the real app. A module boundary
// only sees providers it declares or imports, so a stub can't just sit in
// the root testing module's own `providers` array; it needs its own
// (global) module that SearchModule's DI graph can resolve the token from.
@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: { query: jest.fn().mockResolvedValue(undefined) } }],
  exports: [getDataSourceToken()],
})
class StubDataSourceModule {}

/**
 * Exercises the real HTTP -> controller -> service -> relaxation-ladder ->
 * DTO pipeline for GET /search/filters, the same way main.ts wires it
 * (including the global ValidationPipe). Only the DB-touching seams are
 * stubbed: VehicleSearchRepository (no Postgres in CI) and the injected
 * DataSource that FilterSearchService uses for fire-and-forget analytics
 * logging.
 */

const SAMPLE_VEHICLE: VehicleSearchResultDto = {
  id: '11111111-1111-4111-8111-111111111111',
  vehicleType: 'CAR',
  make: 'Toyota',
  model: 'Aqua',
  condition: 'USED',
  manufactureYear: 2018,
  registrationYear: 2018,
  effectiveYear: 2018,
  price: 6500000,
  isNegotiable: true,
  mileage: 45000,
  fuelType: 'HYBRID',
  transmissionType: 'AUTOMATIC',
  locationCity: 'Colombo',
  locationDistrict: 'Colombo',
  specs: {},
  dealerVerified: true,
  imageUrl: null,
  thumbnailUrl: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('GET /search/filters (e2e)', () => {
  let app: INestApplication;
  let repository: { count: jest.Mock; search: jest.Mock; facets: jest.Mock };

  beforeAll(async () => {
    repository = {
      count: jest.fn().mockResolvedValue(1),
      search: jest.fn().mockResolvedValue([SAMPLE_VEHICLE]),
      facets: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), StubDataSourceModule, SearchModule],
    })
      .overrideProvider(VehicleSearchRepository)
      .useValue(repository)
      .overrideProvider(VehicleDictionaryRepository)
      .useValue({ getVocabulary: jest.fn().mockResolvedValue({}) })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a paginated result set for a plain query', async () => {
    const res = await request(app.getHttpServer())
      .get('/search/filters')
      .query({ vehicleType: 'CAR', maxPrice: 7000000 })
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(SAMPLE_VEHICLE.id);
    expect(repository.count).toHaveBeenCalledTimes(1);
  });

  it('400s on an unknown query param, matching whitelist:true/forbidNonWhitelisted:true in main.ts', async () => {
    await request(app.getHttpServer())
      .get('/search/filters')
      .query({ notARealFilter: 'x' })
      .expect(400);
  });

  it('runs the zero-result relaxation ladder and reports what it dropped', async () => {
    repository.count
      .mockResolvedValueOnce(0) // original filter set: nothing matches
      .mockResolvedValueOnce(1); // after dropping specs: one match

    const res = await request(app.getHttpServer())
      .get('/search/filters')
      .query({ specs: 'seats:7', maxPrice: 7000000 })
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.relaxation).toBeDefined();
    expect(res.body.relaxation.droppedFilters).toEqual(['specs']);
  });

  it('rejects a malformed specs entry with the controller-level BadRequestException', async () => {
    await request(app.getHttpServer())
      .get('/search/filters')
      .query({ specs: 'not-a-key-value-pair' })
      .expect(400);
  });
});
