import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { SearchModule } from '../../src/modules/search/search.module';
import { AliasPromotionService } from '../../src/modules/search/services/alias-promotion.service';
import { VehicleSearchRepository } from '../../src/modules/search/repositories/vehicle-search.repository';
import { VehicleDictionaryRepository } from '../../src/modules/search/repositories/vehicle-dictionary.repository';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { AuthUserView } from '../../src/infrastructure/database/entities/auth-user.view-entity';
import type { AuthenticatedUser, UserRole } from '../../src/modules/auth/types/authenticated-user.type';

@Global()
@Module({
  // Returns rows rather than undefined: SearchOptionsService reads straight
  // off the DataSource, and the public-route check below needs it to answer.
  providers: [{ provide: getDataSourceToken(), useValue: { query: jest.fn().mockResolvedValue([]) } }],
  exports: [getDataSourceToken()],
})
class StubDataSourceModule {}

/**
 * POST /search/aliases/promote is the only write route in SearchModule, and it
 * writes to marketplace.vehicle_dictionaries — reference data every search
 * facet filters against and the ingestion ETL loads a snapshot of on every run.
 * An unguarded version would let anyone who can reach /search make a junk token
 * a permanent alias.
 *
 * This exercises the guard through HTTP rather than trusting the decorator:
 * RolesGuard is left REAL so @Roles('ADMIN') is genuinely evaluated, and only
 * JwtAuthGuard is stubbed — the real one needs a live auth.users lookup.
 * JwtStrategy is overridden for the same reason: it reads JWT config at
 * construction time, which CI does not supply.
 */

const user = (role: UserRole): AuthenticatedUser => ({
  id: '3f6f6b4e-1c2d-4a5b-8c9d-0e1f2a3b4c5d',
  email: `${role.toLowerCase()}@example.com`,
  role,
});

describe('POST /search/aliases/promote (e2e)', () => {
  let app: INestApplication;
  let aliasPromotion: { promoteAliases: jest.Mock };

  /** Flipped per-test to exercise the unauthenticated branch. */
  let authenticated = true;
  let currentUser: AuthenticatedUser = user('ADMIN');

  beforeAll(async () => {
    aliasPromotion = {
      promoteAliases: jest.fn().mockResolvedValue({ candidates: 3, promoted: 1, skipped: 2 }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), StubDataSourceModule, SearchModule],
    })
      .overrideProvider(AliasPromotionService)
      .useValue(aliasPromotion)
      .overrideProvider(VehicleSearchRepository)
      .useValue({ count: jest.fn(), search: jest.fn(), facets: jest.fn() })
      .overrideProvider(VehicleDictionaryRepository)
      .useValue({ getVocabulary: jest.fn().mockResolvedValue({}) })
      .overrideProvider(JwtStrategy)
      .useValue({})
      // JwtAuthModule pulls TypeOrmModule.forFeature([AuthUserView]), whose
      // provider factory reads entity metadata off a real DataSource. The stub
      // above only answers `query`, so the repository token is supplied
      // directly instead.
      .overrideProvider(getRepositoryToken(AuthUserView))
      .useValue({ findOne: jest.fn() })
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
    currentUser = user('ADMIN');
    aliasPromotion.promoteAliases.mockResolvedValue({ candidates: 3, promoted: 1, skipped: 2 });
  });

  it('runs the promotion for an ADMIN and returns the tallies', async () => {
    const response = await request(app.getHttpServer())
      .post('/search/aliases/promote')
      .expect(201); // @Post with no @HttpCode defaults to 201

    expect(response.body).toEqual({ candidates: 3, promoted: 1, skipped: 2 });
  });

  it('refuses a BUYER', async () => {
    currentUser = user('BUYER');

    await request(app.getHttpServer()).post('/search/aliases/promote').expect(403);

    expect(aliasPromotion.promoteAliases).not.toHaveBeenCalled();
  });

  it('refuses a DEALER', async () => {
    // DEALER is privileged elsewhere in this service — it can create and edit
    // listings — so proving it is *not* privileged here is the meaningful case.
    currentUser = user('DEALER');

    await request(app.getHttpServer()).post('/search/aliases/promote').expect(403);

    expect(aliasPromotion.promoteAliases).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    // 403, not 401: a canActivate returning false yields 403. The real
    // JwtAuthGuard throws UnauthorizedException and would give 401, which this
    // stub cannot reproduce without throwing.
    authenticated = false;

    await request(app.getHttpServer()).post('/search/aliases/promote').expect(403);

    expect(aliasPromotion.promoteAliases).not.toHaveBeenCalled();
  });

  it('leaves the rest of the controller public', async () => {
    // The guard is per-method. If someone moved it to the class, every browse
    // route would start demanding a token.
    authenticated = false;

    await request(app.getHttpServer()).get('/search/stats').expect(200);
  });

  it('exposes no GET on the promote path', async () => {
    await request(app.getHttpServer()).get('/search/aliases/promote').expect(404);
  });
});
