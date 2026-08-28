import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { SearchModule } from '../../src/modules/search/search.module';
import { VehicleSearchRepository } from '../../src/modules/search/repositories/vehicle-search.repository';
import { VehicleDictionaryRepository } from '../../src/modules/search/repositories/vehicle-dictionary.repository';

@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: { query: jest.fn().mockResolvedValue(undefined) } }],
  exports: [getDataSourceToken()],
})
class StubDataSourceModule {}

/**
 * GET /search/facets goes straight to VehicleSearchRepository.facets(),
 * bypassing FilterSearchService entirely (controller comment: avoids running
 * the relaxation ladder / writing an analytics row for a request the buyer
 * never made). Exercises that direct routing end to end.
 */
describe('GET /search/facets (e2e)', () => {
  let app: INestApplication;
  let repository: { facets: jest.Mock };

  beforeAll(async () => {
    repository = {
      facets: jest.fn().mockResolvedValue({
        vehicleType: [{ value: 'CAR', count: 12 }],
        make: [{ value: 'Toyota', count: 5 }],
      }),
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
    await app.close();
  });

  it('returns facet buckets for the given filter set', async () => {
    const res = await request(app.getHttpServer())
      .get('/search/facets')
      .query({ vehicleType: 'CAR' })
      .expect(200);

    expect(res.body).toEqual({
      vehicleType: [{ value: 'CAR', count: 12 }],
      make: [{ value: 'Toyota', count: 5 }],
    });
    expect(repository.facets).toHaveBeenCalledTimes(1);
  });

  it('returns facets even with no filters applied (initial page load)', async () => {
    await request(app.getHttpServer()).get('/search/facets').expect(200);
    expect(repository.facets).toHaveBeenCalled();
  });

  it('400s on an unknown query param (same DTO/ValidationPipe as /search/filters)', async () => {
    await request(app.getHttpServer())
      .get('/search/facets')
      .query({ notARealFilter: 'x' })
      .expect(400);
  });
});
