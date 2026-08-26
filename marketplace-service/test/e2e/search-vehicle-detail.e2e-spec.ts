import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { SearchModule } from '../../src/modules/search/search.module';
import { VehicleSearchRepository } from '../../src/modules/search/repositories/vehicle-search.repository';
import { VehicleDictionaryRepository } from '../../src/modules/search/repositories/vehicle-dictionary.repository';
import { VehicleDetailDto } from '../../src/modules/search/dto/filter-search-response.dto';

@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: { query: jest.fn().mockResolvedValue(undefined) } }],
  exports: [getDataSourceToken()],
})
class StubDataSourceModule {}

const VEHICLE_ID = '33333333-3333-4333-8333-333333333333';

const SAMPLE_DETAIL: VehicleDetailDto = {
  id: VEHICLE_ID,
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
  description: 'A well-maintained hybrid.',
  color: 'White',
  ownersCount: 1,
  engineCapacityCc: 1500,
  images: [],
  dealer: {
    id: 'dealer-1',
    companyName: 'Acme Motors',
    city: 'Colombo',
    contactNumber: '+94771234567',
    verified: true,
  },
};

/**
 * GET /search/vehicles/:id. findById already gates on status = 'LIVE' at the
 * repository layer (see vehicle-search.repository.ts), so a DRAFT/SOLD
 * listing and a genuinely missing id are indistinguishable here — both
 * surface as a plain 404, by design (a direct link must not confirm a
 * non-live listing exists).
 */
describe('GET /search/vehicles/:id (e2e)', () => {
  let app: INestApplication;
  let repository: { findById: jest.Mock };

  beforeAll(async () => {
    repository = { findById: jest.fn() };

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

  afterEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await app.close();
  });

  it('returns the full listing detail for a LIVE vehicle', async () => {
    repository.findById.mockResolvedValue(SAMPLE_DETAIL);

    const res = await request(app.getHttpServer())
      .get(`/search/vehicles/${VEHICLE_ID}`)
      .expect(200);

    expect(res.body.id).toBe(VEHICLE_ID);
    expect(res.body.dealer.companyName).toBe('Acme Motors');
  });

  it('404s when the repository returns null (missing, or exists but not LIVE)', async () => {
    repository.findById.mockResolvedValue(null);

    await request(app.getHttpServer()).get(`/search/vehicles/${VEHICLE_ID}`).expect(404);
  });

  it('400s on a non-UUID id (ParseUUIDPipe)', async () => {
    await request(app.getHttpServer()).get('/search/vehicles/not-a-uuid').expect(400);
    expect(repository.findById).not.toHaveBeenCalled();
  });
});
