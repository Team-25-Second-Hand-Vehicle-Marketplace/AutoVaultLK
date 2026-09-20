import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { RecommendationsModule } from '../../src/modules/recommendations/recommendations.module';
import { RecommendationsRepository } from '../../src/modules/recommendations/repositories/recommendations.repository';

/**
 * GET /recommendations/vehicles/:vehicleId is public — no guards — so this
 * exercises the HTTP layer only: ParseIntPipe on the optional `limit`, the
 * clamp the controller applies on top of it, and the 404 the service raises for
 * an unknown vehicle.
 *
 * The clamp matters at this boundary specifically: `limit` is caller-supplied,
 * and without it `?limit=10000` turns one page view into a full table scan.
 */

const VEHICLE_ID = '9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d';

describe('GET /recommendations/vehicles/:vehicleId (e2e)', () => {
  let app: INestApplication;
  let repository: { vehicleExists: jest.Mock; findSimilarVehicles: jest.Mock };

  /** The limit the repository was actually asked for. */
  const limitUsed = (): number =>
    repository.findSimilarVehicles.mock.calls[0][1] as number;

  beforeAll(async () => {
    repository = {
      vehicleExists: jest.fn(),
      findSimilarVehicles: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), RecommendationsModule],
    })
      .overrideProvider(RecommendationsRepository)
      .useValue(repository)
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

  beforeEach(() => {
    jest.clearAllMocks();
    repository.vehicleExists.mockResolvedValue(true);
    repository.findSimilarVehicles.mockResolvedValue([]);
  });

  it('returns the vehicle id alongside its recommendations', async () => {
    repository.findSimilarVehicles.mockResolvedValue([{ id: 'v-2', make: 'Toyota' }]);

    const response = await request(app.getHttpServer())
      .get(`/recommendations/vehicles/${VEHICLE_ID}`)
      .expect(200);

    expect(response.body).toEqual({
      vehicleId: VEHICLE_ID,
      recommendations: [{ id: 'v-2', make: 'Toyota' }],
    });
  });

  it('is public', async () => {
    // No guard on this controller. If one is ever added, browse pages start
    // demanding a token.
    await request(app.getHttpServer())
      .get(`/recommendations/vehicles/${VEHICLE_ID}`)
      .expect(200);
  });

  it('404s an unknown vehicle', async () => {
    // Distinct from "no similar vehicles", which is a legitimate empty list.
    repository.vehicleExists.mockResolvedValue(false);

    await request(app.getHttpServer())
      .get(`/recommendations/vehicles/${VEHICLE_ID}`)
      .expect(404);
  });

  it('returns an empty list when nothing is similar', async () => {
    const response = await request(app.getHttpServer())
      .get(`/recommendations/vehicles/${VEHICLE_ID}`)
      .expect(200);

    expect(response.body.recommendations).toEqual([]);
  });

  describe('the limit', () => {
    it('defaults to 6 when absent', async () => {
      await request(app.getHttpServer())
        .get(`/recommendations/vehicles/${VEHICLE_ID}`)
        .expect(200);

      expect(limitUsed()).toBe(6);
    });

    it('passes an in-range value through', async () => {
      await request(app.getHttpServer())
        .get(`/recommendations/vehicles/${VEHICLE_ID}?limit=12`)
        .expect(200);

      expect(limitUsed()).toBe(12);
    });

    it('caps a large value at 20', async () => {
      await request(app.getHttpServer())
        .get(`/recommendations/vehicles/${VEHICLE_ID}?limit=10000`)
        .expect(200);

      expect(limitUsed()).toBe(20);
    });

    it('floors zero at 1', async () => {
      await request(app.getHttpServer())
        .get(`/recommendations/vehicles/${VEHICLE_ID}?limit=0`)
        .expect(200);

      expect(limitUsed()).toBe(1);
    });

    it('400s a non-numeric limit', async () => {
      // ParseIntPipe, before the clamp sees it.
      await request(app.getHttpServer())
        .get(`/recommendations/vehicles/${VEHICLE_ID}?limit=many`)
        .expect(400);

      expect(repository.findSimilarVehicles).not.toHaveBeenCalled();
    });
  });
});
