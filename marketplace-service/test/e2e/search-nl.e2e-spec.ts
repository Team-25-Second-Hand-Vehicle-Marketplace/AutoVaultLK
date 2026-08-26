import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { SearchModule } from '../../src/modules/search/search.module';
import { VehicleSearchRepository } from '../../src/modules/search/repositories/vehicle-search.repository';
import { VehicleDictionaryRepository } from '../../src/modules/search/repositories/vehicle-dictionary.repository';
import { VehicleSearchResultDto } from '../../src/modules/search/dto/filter-search-response.dto';

// See search-filters.e2e-spec.ts for why this stub module is needed:
// SearchModule has no DataSource provider of its own outside the real app.
@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: { query: jest.fn().mockResolvedValue(undefined) } }],
  exports: [getDataSourceToken()],
})
class StubDataSourceModule {}

const SAMPLE_VEHICLE: VehicleSearchResultDto = {
  id: '22222222-2222-4222-8222-222222222222',
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

/**
 * Exercises GET /search/nl end to end: HTTP -> controller -> NlSearchService
 * -> deterministic parser -> Groq fallback (skipped, no GROQ_API_KEY in CI)
 * -> QueryEmbeddingService (skipped, EMBEDDING_DISABLED=true) -> filter
 * search. Only DB-touching seams are stubbed.
 */
describe('GET /search/nl (e2e)', () => {
  let app: INestApplication;
  let repository: { count: jest.Mock; search: jest.Mock; facets: jest.Mock };

  beforeAll(async () => {
    process.env.EMBEDDING_DISABLED = 'true';

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
      .useValue({ getParserVocabulary: jest.fn().mockResolvedValue({ makes: [], models: [], bodyTypes: [] }) })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    delete process.env.EMBEDDING_DISABLED;
    await app.close();
  });

  it('parses a free-text query and returns results plus parse diagnostics', async () => {
    const res = await request(app.getHttpServer())
      .get('/search/nl')
      .query({ q: 'toyota under 8m' })
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.parse).toBeDefined();
    expect(typeof res.body.parse.confidence).toBe('number');
    expect(res.body.parse.usedGroqFallback).toBe(false); // no GROQ_API_KEY set in CI
  });

  it('400s when q is missing (IsNotEmpty)', async () => {
    await request(app.getHttpServer()).get('/search/nl').query({}).expect(400);
  });

  it('400s when q exceeds the 500-character limit', async () => {
    await request(app.getHttpServer())
      .get('/search/nl')
      .query({ q: 'x'.repeat(501) })
      .expect(400);
  });

  it('400s on an unknown query param', async () => {
    await request(app.getHttpServer())
      .get('/search/nl')
      .query({ q: 'toyota', notARealParam: 'x' })
      .expect(400);
  });

  it('trims whitespace from q before parsing', async () => {
    const res = await request(app.getHttpServer())
      .get('/search/nl')
      .query({ q: '  toyota  ' })
      .expect(200);

    expect(res.body.items).toHaveLength(1);
  });
});
