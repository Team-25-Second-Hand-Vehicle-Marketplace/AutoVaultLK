import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { FavouritesModule } from '../../src/modules/favourites/favourite.module';
import { FavouritesRepository } from '../../src/modules/favourites/repositories/favourites.repository';
import { Favourite } from '../../src/infrastructure/database/entities/favourite.entity';
import { AuthUserView } from '../../src/infrastructure/database/entities/auth-user.view-entity';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import type { AuthenticatedUser } from '../../src/modules/auth/types/authenticated-user.type';

/**
 * Exercises the favourites routes through HTTP, and pins the route path.
 *
 * The controller used to be `@Controller('marketplace/favourites')` — the only
 * prefixed controller in the service. nginx proxies `location /marketplace/` to
 * `http://marketplace_service/`, and the trailing slash strips the prefix, so
 * every one of these routes 404'd behind the gateway. The `/marketplace/...`
 * case below is the regression lock for that.
 *
 * FavouritesRepository is overridden rather than stubbing TypeORM, and
 * JwtAuthGuard is stubbed because the real one needs a live auth.users lookup.
 * RolesGuard stays real — this controller declares no @Roles, so it should
 * short-circuit, and that is worth proving rather than assuming.
 */

const BUYER: AuthenticatedUser = {
  id: 'buyer-1',
  email: 'buyer@example.com',
  role: 'BUYER',
};

const VEHICLE_ID = '9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d';

describe('favourites (e2e)', () => {
  let app: INestApplication;
  let repository: {
    findFavourite: jest.Mock;
    createFavourite: jest.Mock;
    findByBuyer: jest.Mock;
    deleteFavourite: jest.Mock;
  };

  let authenticated = true;
  let currentUser: AuthenticatedUser = BUYER;

  beforeAll(async () => {
    repository = {
      findFavourite: jest.fn(),
      createFavourite: jest.fn(),
      findByBuyer: jest.fn(),
      deleteFavourite: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), FavouritesModule],
    })
      .overrideProvider(FavouritesRepository)
      .useValue(repository)
      // The module registers both entities through TypeOrmModule.forFeature;
      // supplying the tokens directly avoids needing a real DataSource.
      .overrideProvider(getRepositoryToken(Favourite))
      .useValue({})
      .overrideProvider(getRepositoryToken(AuthUserView))
      .useValue({ findOne: jest.fn() })
      .overrideProvider(JwtStrategy)
      .useValue({})
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => { getRequest: () => { user?: AuthenticatedUser } };
        }) => {
          if (!authenticated) return false;
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
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
    authenticated = true;
    currentUser = BUYER;
  });

  describe('the route path', () => {
    it('is mounted at /favourites', async () => {
      repository.findByBuyer.mockResolvedValue([]);

      await request(app.getHttpServer()).get('/favourites').expect(200);
    });

    it('is NOT mounted at /marketplace/favourites', async () => {
      // The regression lock. nginx strips `/marketplace/` before forwarding, so
      // a controller carrying that prefix is unreachable through the gateway.
      await request(app.getHttpServer()).get('/marketplace/favourites').expect(404);
    });
  });

  describe('POST /favourites/:vehicleId', () => {
    it('saves the vehicle for the caller', async () => {
      repository.findFavourite.mockResolvedValue(null);
      repository.createFavourite.mockResolvedValue({ id: 'f-1', vehicleId: VEHICLE_ID });

      const response = await request(app.getHttpServer())
        .post(`/favourites/${VEHICLE_ID}`)
        .expect(201);

      expect(response.body).toMatchObject({ id: 'f-1' });
      expect(repository.createFavourite).toHaveBeenCalledWith('buyer-1', VEHICLE_ID);
    });

    it('409s a duplicate', async () => {
      repository.findFavourite.mockResolvedValue({ id: 'f-1' });

      const response = await request(app.getHttpServer())
        .post(`/favourites/${VEHICLE_ID}`)
        .expect(409);

      expect(response.body.message).toMatch(/already in favourites/i);
    });

    it('refuses an unauthenticated caller', async () => {
      // 403, not 401: a canActivate returning false yields 403. The real guard
      // throws UnauthorizedException and would give 401.
      authenticated = false;

      await request(app.getHttpServer()).post(`/favourites/${VEHICLE_ID}`).expect(403);

      expect(repository.createFavourite).not.toHaveBeenCalled();
    });
  });

  describe('GET /favourites', () => {
    it('returns the caller\'s own list', async () => {
      repository.findByBuyer.mockResolvedValue([{ id: 'f-1' }]);

      const response = await request(app.getHttpServer()).get('/favourites').expect(200);

      expect(response.body).toEqual([{ id: 'f-1' }]);
      expect(repository.findByBuyer).toHaveBeenCalledWith('buyer-1');
    });

    it('scopes the list to the token, not to any request input', async () => {
      // The authorization boundary. A buyer id read from anywhere but the
      // verified token would let one buyer read another's list.
      currentUser = { ...BUYER, id: 'buyer-2' };
      repository.findByBuyer.mockResolvedValue([]);

      await request(app.getHttpServer()).get('/favourites').expect(200);

      expect(repository.findByBuyer).toHaveBeenCalledWith('buyer-2');
    });

    it('returns an empty list rather than 404 when nothing is saved', async () => {
      repository.findByBuyer.mockResolvedValue([]);

      const response = await request(app.getHttpServer()).get('/favourites').expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('DELETE /favourites/:vehicleId', () => {
    it('removes and confirms', async () => {
      repository.findFavourite.mockResolvedValue({ id: 'f-1' });

      const response = await request(app.getHttpServer())
        .delete(`/favourites/${VEHICLE_ID}`)
        .expect(200);

      expect(response.body).toEqual({ message: 'Vehicle removed from favourites' });
      expect(repository.deleteFavourite).toHaveBeenCalledWith('buyer-1', VEHICLE_ID);
    });

    it('404s what was never saved', async () => {
      repository.findFavourite.mockResolvedValue(null);

      await request(app.getHttpServer()).delete(`/favourites/${VEHICLE_ID}`).expect(404);
    });

    it('refuses an unauthenticated caller', async () => {
      authenticated = false;

      await request(app.getHttpServer()).delete(`/favourites/${VEHICLE_ID}`).expect(403);

      expect(repository.deleteFavourite).not.toHaveBeenCalled();
    });
  });

  it('does not validate vehicleId as a UUID', async () => {
    // Documented rather than asserted as correct: every other id param in this
    // service uses ParseUUIDPipe, so a non-UUID here reaches Postgres and
    // surfaces as a 500 rather than a 400. Worth fixing, but it is a behaviour
    // change beyond this suite.
    repository.findFavourite.mockResolvedValue(null);
    repository.createFavourite.mockResolvedValue({ id: 'f-1' });

    await request(app.getHttpServer()).post('/favourites/not-a-uuid').expect(201);

    expect(repository.createFavourite).toHaveBeenCalledWith('buyer-1', 'not-a-uuid');
  });
});
