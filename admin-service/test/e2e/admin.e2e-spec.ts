import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AdminController } from '../../src/modules/admin/controllers/admin.controller';
import { AdminReadsService } from '../../src/modules/admin/services/admin-reads.service';
import { AdminMutationsService } from '../../src/modules/admin/services/admin-mutations.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../src/modules/auth/types/authenticated-user.type';

/**
 * Exercises the /admin surface through real routing, the real RolesGuard, the
 * real ParseUUIDPipe and the same ValidationPipe main.ts installs, with only
 * the two services stubbed.
 *
 * **The guard matrix is the point of this suite.** AdminController is the
 * highest-privilege surface in the system - it approves dealers, deactivates
 * accounts and mints other admins - and every route on it is protected by a
 * class-level `@Roles('ADMIN')` that no unit test exercises end to end. A
 * decorator dropped during a refactor would leave the routes open to any
 * authenticated buyer, and nothing else in the repo would notice.
 *
 * Only JwtAuthGuard is overridden (it would otherwise need a signed token and
 * a running auth service); RolesGuard runs for real, so the role checks below
 * are the production code path.
 *
 * RolesGuard is left to the controller's own `@UseGuards(JwtAuthGuard,
 * RolesGuard)` rather than registered as an APP_GUARD here. A global guard
 * runs *before* controller-scoped ones, so it would read `request.user` before
 * the overridden JwtAuthGuard had set it and 403 every route — including the
 * ones an admin is entitled to.
 */

const ADMIN_ID = '2c4a1f6e-9b3d-4c8a-9e1f-5d7b3a2c4e6f';
const DEALER_ID = '7b1e3d5f-2a4c-4e6b-8d0f-1a3c5e7b9d0f';
const USER_ID = '4e6b8d0f-1a3c-4e6b-8d0f-2a4c6e8b0d2f';

const ADMIN: AuthenticatedUser = {
  id: ADMIN_ID,
  email: 'admin@example.com',
  role: 'ADMIN',
};

const BUYER: AuthenticatedUser = {
  id: USER_ID,
  email: 'buyer@example.com',
  role: 'BUYER',
};

const DEALER: AuthenticatedUser = {
  id: DEALER_ID,
  email: 'dealer@example.com',
  role: 'DEALER',
};

/** Every route on the controller, as the guard matrix walks them. */
const ROUTES: ReadonlyArray<{ method: 'get' | 'post'; path: string }> = [
  { method: 'get', path: '/admin/dashboard' },
  { method: 'get', path: '/admin/users' },
  { method: 'get', path: `/admin/dealers/${DEALER_ID}` },
  { method: 'get', path: '/admin/uploads' },
  { method: 'get', path: '/admin/reports?from=2026-01-01&to=2026-02-01' },
  { method: 'get', path: '/admin/audit-logs' },
  { method: 'post', path: `/admin/dealers/${DEALER_ID}/approve` },
  { method: 'post', path: `/admin/dealers/${DEALER_ID}/reject` },
  { method: 'post', path: `/admin/users/${USER_ID}/deactivate` },
  { method: 'post', path: `/admin/users/${USER_ID}/reactivate` },
  { method: 'post', path: '/admin/users' },
];

describe('AdminController (e2e)', () => {
  let app: INestApplication;
  let reads: Record<string, jest.Mock>;
  let mutations: Record<string, jest.Mock>;

  /** Swapped per test to impersonate a caller, or null for no token at all. */
  let currentUser: AuthenticatedUser | null = ADMIN;

  beforeAll(async () => {
    reads = {
      dashboard: jest.fn(),
      listUsers: jest.fn(),
      findDealer: jest.fn(),
      listUploads: jest.fn(),
      reports: jest.fn(),
      auditLogsSearch: jest.fn(),
    };
    mutations = {
      approveDealer: jest.fn(),
      rejectDealer: jest.fn(),
      deactivateUser: jest.fn(),
      reactivateUser: jest.fn(),
      createAdmin: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminReadsService, useValue: reads },
        { provide: AdminMutationsService, useValue: mutations },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => {
            getRequest: () => { user?: AuthenticatedUser };
          };
        }) => {
          if (!currentUser) return false;
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    // Same pipe configuration as src/main.ts - whitelist + forbidNonWhitelisted
    // is what turns an unknown query parameter into a 400 rather than silently
    // dropping it.
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
    currentUser = ADMIN;
    jest.clearAllMocks();
    for (const fn of Object.values(reads)) fn.mockResolvedValue({});
    for (const fn of Object.values(mutations)) fn.mockResolvedValue({});
  });

  describe('guard matrix', () => {
    it.each(ROUTES)(
      'refuses an unauthenticated caller on $method $path',
      async ({ method, path }) => {
        currentUser = null;

        await request(app.getHttpServer())[method](path).expect(403);
      },
    );

    // The class-level @Roles('ADMIN') is the only thing standing between a
    // logged-in buyer and the dealer-approval endpoints.
    it.each(ROUTES)(
      'refuses a BUYER on $method $path',
      async ({ method, path }) => {
        currentUser = BUYER;

        await request(app.getHttpServer())[method](path).expect(403);
      },
    );

    it.each(ROUTES)(
      'refuses a DEALER on $method $path',
      async ({ method, path }) => {
        currentUser = DEALER;

        await request(app.getHttpServer())[method](path).expect(403);
      },
    );

    it('does not reach the service when the role check fails', async () => {
      currentUser = BUYER;

      await request(app.getHttpServer()).get('/admin/dashboard').expect(403);

      expect(reads.dashboard).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/dashboard (FR-48)', () => {
    it('returns the mapped dashboard payload', async () => {
      reads.dashboard.mockResolvedValue({ totalUsers: 12, pendingDealers: 3 });

      const response = await request(app.getHttpServer())
        .get('/admin/dashboard')
        .expect(200);

      expect(response.body).toEqual({ totalUsers: 12, pendingDealers: 3 });
    });
  });

  describe('GET /admin/users', () => {
    it('passes the verificationStatus filter through', async () => {
      await request(app.getHttpServer())
        .get('/admin/users?verificationStatus=PENDING')
        .expect(200);

      expect(reads.listUsers).toHaveBeenCalledWith('PENDING');
    });

    it('omits the filter when none is given', async () => {
      await request(app.getHttpServer()).get('/admin/users').expect(200);

      expect(reads.listUsers).toHaveBeenCalledWith(undefined);
    });

    it('400s an unknown verification status', async () => {
      await request(app.getHttpServer())
        .get('/admin/users?verificationStatus=BANANA')
        .expect(400);

      expect(reads.listUsers).not.toHaveBeenCalled();
    });

    // forbidNonWhitelisted: a mistyped filter name must fail loudly rather
    // than return an unfiltered list the admin believes is filtered.
    it('400s an unknown query parameter', async () => {
      await request(app.getHttpServer())
        .get('/admin/users?verifcationStatus=PENDING')
        .expect(400);
    });
  });

  describe('GET /admin/dealers/:id', () => {
    it('returns the dealer profile', async () => {
      reads.findDealer.mockResolvedValue({
        userId: DEALER_ID,
        businessName: 'Auto Lanka',
      });

      const response = await request(app.getHttpServer())
        .get(`/admin/dealers/${DEALER_ID}`)
        .expect(200);

      expect(response.body).toMatchObject({ businessName: 'Auto Lanka' });
      expect(reads.findDealer).toHaveBeenCalledWith(DEALER_ID);
    });

    it('400s a malformed id before reaching the service', async () => {
      await request(app.getHttpServer())
        .get('/admin/dealers/not-a-uuid')
        .expect(400);

      expect(reads.findDealer).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/uploads (FR-44)', () => {
    it('passes the status filter through', async () => {
      await request(app.getHttpServer())
        .get('/admin/uploads?status=FAILED')
        .expect(200);

      expect(reads.listUploads).toHaveBeenCalledWith('FAILED');
    });

    it('400s an unknown upload status', async () => {
      await request(app.getHttpServer())
        .get('/admin/uploads?status=BANANA')
        .expect(400);
    });
  });

  describe('GET /admin/reports (FR-45)', () => {
    it('coerces the date range and passes it through', async () => {
      await request(app.getHttpServer())
        .get('/admin/reports?from=2026-01-01&to=2026-02-01')
        .expect(200);

      const [from, to] = reads.reports.mock.calls[0] as [Date, Date];
      expect(from).toBeInstanceOf(Date);
      expect(to).toBeInstanceOf(Date);
      expect(from.toISOString()).toContain('2026-01-01');
    });

    // from and to are required on ReportsQueryDto, unlike every other filter
    // on this controller.
    it('400s a missing date range', async () => {
      await request(app.getHttpServer()).get('/admin/reports').expect(400);

      expect(reads.reports).not.toHaveBeenCalled();
    });

    it('400s an unparseable date', async () => {
      await request(app.getHttpServer())
        .get('/admin/reports?from=last-tuesday&to=2026-02-01')
        .expect(400);
    });
  });

  describe('GET /admin/audit-logs (FR-47)', () => {
    it('forwards the search filters as one query object', async () => {
      await request(app.getHttpServer())
        .get(`/admin/audit-logs?action=DEALER_APPROVED&actorId=${ADMIN_ID}`)
        .expect(200);

      expect(reads.auditLogsSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEALER_APPROVED',
          actorId: ADMIN_ID,
        }),
      );
    });

    it('400s a non-UUID actorId', async () => {
      await request(app.getHttpServer())
        .get('/admin/audit-logs?actorId=someone')
        .expect(400);
    });
  });

  describe('dealer approval (FR-09)', () => {
    it('approves with the acting admin recorded', async () => {
      // FR-02.2: the decision must carry who made it, not just that it happened.
      await request(app.getHttpServer())
        .post(`/admin/dealers/${DEALER_ID}/approve`)
        .expect(201);

      expect(mutations.approveDealer).toHaveBeenCalledWith(
        DEALER_ID,
        expect.objectContaining({ id: ADMIN_ID, role: 'ADMIN' }),
        expect.anything(),
      );
    });

    it('records the forwarded client ip', async () => {
      await request(app.getHttpServer())
        .post(`/admin/dealers/${DEALER_ID}/approve`)
        .set('x-forwarded-for', '203.0.113.7, 10.0.0.1')
        .expect(201);

      const [, , ip] = mutations.approveDealer.mock.calls[0] as [
        string,
        unknown,
        string,
      ];
      // The first entry is the client; the rest are proxy hops.
      expect(ip).toBe('203.0.113.7');
    });

    it('rejects with a reason', async () => {
      await request(app.getHttpServer())
        .post(`/admin/dealers/${DEALER_ID}/reject`)
        .send({ reason: 'Business registration number could not be verified' })
        .expect(201);

      expect(mutations.rejectDealer).toHaveBeenCalledWith(
        DEALER_ID,
        expect.anything(),
        expect.anything(),
        'Business registration number could not be verified',
      );
    });

    // RejectDealerDto keeps reason optional so the current admin UI, which
    // posts an empty body, keeps working.
    it('rejects without a reason', async () => {
      await request(app.getHttpServer())
        .post(`/admin/dealers/${DEALER_ID}/reject`)
        .expect(201);

      expect(mutations.rejectDealer).toHaveBeenCalledWith(
        DEALER_ID,
        expect.anything(),
        expect.anything(),
        undefined,
      );
    });

    it('400s a reason below the minimum length', async () => {
      await request(app.getHttpServer())
        .post(`/admin/dealers/${DEALER_ID}/reject`)
        .send({ reason: 'no' })
        .expect(400);

      expect(mutations.rejectDealer).not.toHaveBeenCalled();
    });

    it('400s a malformed dealer id', async () => {
      await request(app.getHttpServer())
        .post('/admin/dealers/not-a-uuid/approve')
        .expect(400);

      expect(mutations.approveDealer).not.toHaveBeenCalled();
    });
  });

  describe('account deactivation (FR-11)', () => {
    it('deactivates with the acting admin recorded', async () => {
      await request(app.getHttpServer())
        .post(`/admin/users/${USER_ID}/deactivate`)
        .expect(201);

      expect(mutations.deactivateUser).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ id: ADMIN_ID }),
        expect.anything(),
      );
    });

    it('reactivates', async () => {
      await request(app.getHttpServer())
        .post(`/admin/users/${USER_ID}/reactivate`)
        .expect(201);

      expect(mutations.reactivateUser).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ id: ADMIN_ID }),
        expect.anything(),
      );
    });
  });

  describe('POST /admin/users (FR-12)', () => {
    const valid = {
      email: 'new.admin@example.com',
      name: 'New Admin',
      password: 'Str0ngPassw0rd',
    };

    it('provisions an admin', async () => {
      await request(app.getHttpServer())
        .post('/admin/users')
        .send(valid)
        .expect(201);

      expect(mutations.createAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ email: valid.email }),
        expect.objectContaining({ id: ADMIN_ID }),
        expect.anything(),
      );
    });

    // FR-06 password policy, enforced here as well as in auth-user-service so
    // a malformed request fails before crossing a service boundary.
    it.each([
      ['too short', 'Ab1'],
      ['missing an uppercase letter', 'str0ngpassword'],
      ['missing a lowercase letter', 'STR0NGPASSWORD'],
      ['missing a number', 'StrongPassword'],
    ])('400s a password %s', async (_label, password) => {
      await request(app.getHttpServer())
        .post('/admin/users')
        .send({ ...valid, password })
        .expect(400);

      expect(mutations.createAdmin).not.toHaveBeenCalled();
    });

    it('400s a malformed email', async () => {
      await request(app.getHttpServer())
        .post('/admin/users')
        .send({ ...valid, email: 'not-an-email' })
        .expect(400);
    });

    it('400s an unknown body field', async () => {
      await request(app.getHttpServer())
        .post('/admin/users')
        .send({ ...valid, role: 'ADMIN' })
        .expect(400);
    });
  });
});
