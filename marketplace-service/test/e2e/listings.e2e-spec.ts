import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ListingModule } from '../../src/modules/listings/listing.module';
import { ListingService } from '../../src/modules/listings/services/listing.service';
import { Vehicle } from '../../src/infrastructure/database/entities/vehicle.entity';
import { VehicleImage } from '../../src/infrastructure/database/entities/vehicle-image.entity';
import { AuthUserView } from '../../src/infrastructure/database/entities/auth-user.view-entity';
import { DealerProfileView } from '../../src/infrastructure/database/entities/dealer-profile.view-entity';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import type {
  AuthenticatedUser,
  UserRole,
} from '../../src/modules/auth/types/authenticated-user.type';

/**
 * The listings controller mixes public browse routes with DEALER/ADMIN-guarded
 * writes, and its unit spec only proves each handler delegates. This exercises
 * the two things that live above the handler and are untested anywhere else:
 * the @Roles wiring, and the route ordering that makes `GET /listings/mine`
 * resolve to its own handler rather than to `GET /listings/:id`.
 *
 * ListingService is overridden wholesale — the service's own logic has its own
 * spec, and what is under test here is routing and authorization.
 */

const VEHICLE_ID = '9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d';

const user = (role: UserRole): AuthenticatedUser => ({
  id: 'actor-1',
  email: `${role.toLowerCase()}@example.com`,
  role,
});

const VALID_LISTING = {
  make: 'Toyota',
  model: 'Vitz',
  manufactureYear: 2015,
  price: 3_500_000,
  mileage: 45_000,
  fuelType: 'PETROL',
  transmissionType: 'AUTOMATIC',
};

describe('listings (e2e)', () => {
  let app: INestApplication;
  let listingService: {
    createListing: jest.Mock;
    getAllListings: jest.Mock;
    getMyListings: jest.Mock;
    getListingById: jest.Mock;
    updateListing: jest.Mock;
    deactivateListing: jest.Mock;
    approveListing: jest.Mock;
    uploadImages: jest.Mock;
  };

  let authenticated = true;
  let currentUser: AuthenticatedUser = user('DEALER');

  beforeAll(async () => {
    listingService = {
      createListing: jest.fn().mockResolvedValue({ id: VEHICLE_ID }),
      getAllListings: jest.fn().mockResolvedValue([]),
      getMyListings: jest.fn().mockResolvedValue([]),
      getListingById: jest.fn().mockResolvedValue({ id: VEHICLE_ID }),
      updateListing: jest.fn().mockResolvedValue({ id: VEHICLE_ID }),
      deactivateListing: jest.fn().mockResolvedValue({ id: VEHICLE_ID }),
      approveListing: jest.fn().mockResolvedValue({ id: VEHICLE_ID }),
      uploadImages: jest.fn().mockResolvedValue({ data: [] }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), ListingModule],
    })
      .overrideProvider(ListingService)
      .useValue(listingService)
      // Entity tokens supplied directly rather than standing up a DataSource:
      // ListingModule pulls DealerModule, ImagesModule and JwtAuthModule,
      // each registering their own entities.
      .overrideProvider(getRepositoryToken(Vehicle))
      .useValue({})
      .overrideProvider(getRepositoryToken(VehicleImage))
      .useValue({})
      .overrideProvider(getRepositoryToken(AuthUserView))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(getRepositoryToken(DealerProfileView))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(JwtStrategy)
      .useValue({})
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => {
            getRequest: () => { user?: AuthenticatedUser };
          };
        }) => {
          if (!authenticated) return false;
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
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

  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
    currentUser = user('DEALER');
    listingService.getAllListings.mockResolvedValue([]);
    listingService.getMyListings.mockResolvedValue([]);
    listingService.getListingById.mockResolvedValue({ id: VEHICLE_ID });
    listingService.createListing.mockResolvedValue({ id: VEHICLE_ID });
    listingService.updateListing.mockResolvedValue({ id: VEHICLE_ID });
    listingService.deactivateListing.mockResolvedValue({ id: VEHICLE_ID });
    listingService.approveListing.mockResolvedValue({ id: VEHICLE_ID });
    listingService.uploadImages.mockResolvedValue({ data: [] });
  });

  describe('route ordering', () => {
    it('resolves GET /listings/mine to its own handler, not to :id', async () => {
      // @Get('mine') is declared before @Get(':id') for exactly this reason.
      // Reordering them would make "mine" a UUID param and 400 on ParseUUIDPipe
      // — which a status-only assertion could mistake for a pass, so this
      // asserts which service method ran.
      await request(app.getHttpServer()).get('/listings/mine').expect(200);

      expect(listingService.getMyListings).toHaveBeenCalled();
      expect(listingService.getListingById).not.toHaveBeenCalled();
    });
  });

  describe('public routes', () => {
    it('GET /listings needs no token', async () => {
      authenticated = false;

      await request(app.getHttpServer()).get('/listings').expect(200);
    });

    it('GET /listings/:id needs no token', async () => {
      authenticated = false;

      await request(app.getHttpServer())
        .get(`/listings/${VEHICLE_ID}`)
        .expect(200);
    });

    it('400s a non-UUID id before reaching the service', async () => {
      // ParseUUIDPipe. Without it the id reaches Postgres and raises 22P02,
      // surfacing as a 500.
      await request(app.getHttpServer())
        .get('/listings/not-a-uuid')
        .expect(400);

      expect(listingService.getListingById).not.toHaveBeenCalled();
    });
  });

  describe('POST /listings', () => {
    it('allows a DEALER', async () => {
      await request(app.getHttpServer())
        .post('/listings')
        .send(VALID_LISTING)
        .expect(201);

      expect(listingService.createListing).toHaveBeenCalled();
    });

    it('allows an ADMIN', async () => {
      currentUser = user('ADMIN');

      await request(app.getHttpServer())
        .post('/listings')
        .send(VALID_LISTING)
        .expect(201);
    });

    it('refuses a BUYER', async () => {
      currentUser = user('BUYER');

      await request(app.getHttpServer())
        .post('/listings')
        .send(VALID_LISTING)
        .expect(403);

      expect(listingService.createListing).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated caller', async () => {
      // 403, not 401: a canActivate returning false yields 403.
      authenticated = false;

      await request(app.getHttpServer())
        .post('/listings')
        .send(VALID_LISTING)
        .expect(403);
    });

    it('400s an unknown field', async () => {
      // forbidNonWhitelisted in main.ts's ValidationPipe, replicated above.
      await request(app.getHttpServer())
        .post('/listings')
        .send({ ...VALID_LISTING, notAColumn: 'x' })
        .expect(400);
    });

    it('passes the actor from the token, not the body', async () => {
      // A dealerId in the body must not be able to assign stock to someone
      // else; the actor comes from @CurrentUser().
      await request(app.getHttpServer())
        .post('/listings')
        .send(VALID_LISTING)
        .expect(201);

      expect(listingService.createListing.mock.calls[0][1]).toMatchObject({
        id: 'actor-1',
        role: 'DEALER',
      });
    });
  });

  describe('GET /listings/mine', () => {
    it('refuses a BUYER', async () => {
      currentUser = user('BUYER');

      await request(app.getHttpServer()).get('/listings/mine').expect(403);
    });

    it('refuses an ADMIN', async () => {
      // @Roles('DEALER') only — genuinely surprising, since ADMIN is
      // privileged on every other write here, so worth pinning.
      currentUser = user('ADMIN');

      await request(app.getHttpServer()).get('/listings/mine').expect(403);
    });

    it('passes no sort by default', async () => {
      await request(app.getHttpServer()).get('/listings/mine').expect(200);

      expect(listingService.getMyListings).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
      );
    });

    it('passes sort=confidence_asc through (FR-42.1)', async () => {
      await request(app.getHttpServer())
        .get('/listings/mine?sort=confidence_asc')
        .expect(200);

      expect(listingService.getMyListings).toHaveBeenCalledWith(
        expect.anything(),
        'confidence_asc',
      );
    });

    it('400s an unknown sort value', async () => {
      await request(app.getHttpServer())
        .get('/listings/mine?sort=price_asc')
        .expect(400);

      expect(listingService.getMyListings).not.toHaveBeenCalled();
    });
  });

  describe('PATCH routes', () => {
    it('allows a DEALER to update', async () => {
      await request(app.getHttpServer())
        .patch(`/listings/${VEHICLE_ID}`)
        .send({ price: 3_400_000 })
        .expect(200);

      expect(listingService.updateListing).toHaveBeenCalled();
    });

    it('refuses a BUYER updating', async () => {
      currentUser = user('BUYER');

      await request(app.getHttpServer())
        .patch(`/listings/${VEHICLE_ID}`)
        .send({ price: 1 })
        .expect(403);

      expect(listingService.updateListing).not.toHaveBeenCalled();
    });

    it('allows a DEALER to deactivate', async () => {
      await request(app.getHttpServer())
        .patch(`/listings/${VEHICLE_ID}/deactivate`)
        .expect(200);

      expect(listingService.deactivateListing).toHaveBeenCalled();
    });

    it('refuses a BUYER deactivating', async () => {
      currentUser = user('BUYER');

      await request(app.getHttpServer())
        .patch(`/listings/${VEHICLE_ID}/deactivate`)
        .expect(403);

      expect(listingService.deactivateListing).not.toHaveBeenCalled();
    });

    it('allows a DEALER to approve (FR-42)', async () => {
      await request(app.getHttpServer())
        .patch(`/listings/${VEHICLE_ID}/approve`)
        .expect(200);

      expect(listingService.approveListing).toHaveBeenCalled();
    });

    it('allows an ADMIN to approve', async () => {
      currentUser = user('ADMIN');

      await request(app.getHttpServer())
        .patch(`/listings/${VEHICLE_ID}/approve`)
        .expect(200);

      expect(listingService.approveListing).toHaveBeenCalled();
    });

    it('refuses a BUYER approving', async () => {
      currentUser = user('BUYER');

      await request(app.getHttpServer())
        .patch(`/listings/${VEHICLE_ID}/approve`)
        .expect(403);

      expect(listingService.approveListing).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated caller approving', async () => {
      authenticated = false;

      await request(app.getHttpServer())
        .patch(`/listings/${VEHICLE_ID}/approve`)
        .expect(403);

      expect(listingService.approveListing).not.toHaveBeenCalled();
    });

    it('400s a non-UUID id on approve before reaching the service', async () => {
      await request(app.getHttpServer())
        .patch('/listings/not-a-uuid/approve')
        .expect(400);

      expect(listingService.approveListing).not.toHaveBeenCalled();
    });
  });

  describe('POST :id/images (FR-58)', () => {
    const attachOneImage = (req: request.Test) =>
      req.attach('images', Buffer.from('jpeg-bytes'), 'front.jpg');

    it('allows a DEALER to upload images', async () => {
      await attachOneImage(
        request(app.getHttpServer()).post(`/listings/${VEHICLE_ID}/images`),
      ).expect(201);

      expect(listingService.uploadImages).toHaveBeenCalled();
    });

    it('allows an ADMIN to upload images', async () => {
      currentUser = user('ADMIN');

      await attachOneImage(
        request(app.getHttpServer()).post(`/listings/${VEHICLE_ID}/images`),
      ).expect(201);

      expect(listingService.uploadImages).toHaveBeenCalled();
    });

    it('refuses a BUYER', async () => {
      currentUser = user('BUYER');

      await attachOneImage(
        request(app.getHttpServer()).post(`/listings/${VEHICLE_ID}/images`),
      ).expect(403);

      expect(listingService.uploadImages).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated caller', async () => {
      authenticated = false;

      await attachOneImage(
        request(app.getHttpServer()).post(`/listings/${VEHICLE_ID}/images`),
      ).expect(403);

      expect(listingService.uploadImages).not.toHaveBeenCalled();
    });

    it('400s a non-UUID id before reaching the service', async () => {
      await attachOneImage(
        request(app.getHttpServer()).post('/listings/not-a-uuid/images'),
      ).expect(400);

      expect(listingService.uploadImages).not.toHaveBeenCalled();
    });

    // The controller's own guard, ahead of ListingService.uploadImages —
    // proves a request with no file attached never reaches the (mocked)
    // service at all.
    it('400s when no file is attached', async () => {
      await request(app.getHttpServer())
        .post(`/listings/${VEHICLE_ID}/images`)
        .expect(400);

      expect(listingService.uploadImages).not.toHaveBeenCalled();
    });

    it('passes the actor from the token, not the body', async () => {
      await attachOneImage(
        request(app.getHttpServer()).post(`/listings/${VEHICLE_ID}/images`),
      ).expect(201);

      expect(listingService.uploadImages).toHaveBeenCalledWith(
        VEHICLE_ID,
        expect.objectContaining({ id: 'actor-1', role: 'DEALER' }),
        expect.anything(),
      );
    });

    it('accepts multiple files in one request', async () => {
      const req = request(app.getHttpServer()).post(
        `/listings/${VEHICLE_ID}/images`,
      );
      await req
        .attach('images', Buffer.from('a'), 'a.jpg')
        .attach('images', Buffer.from('b'), 'b.jpg')
        .expect(201);

      expect(listingService.uploadImages).toHaveBeenCalledWith(
        VEHICLE_ID,
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({ originalname: 'a.jpg' }),
          expect.objectContaining({ originalname: 'b.jpg' }),
        ]),
      );
    });
  });
});
