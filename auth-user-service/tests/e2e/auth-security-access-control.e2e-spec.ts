import {
  AuthE2eContext,
  DEFAULT_IP,
  STRONG_PASSWORD,
  bearer,
  closeAuthE2eApp,
  createAuthE2eApp,
  login,
  registerAndVerifyDealer,
  seedVerifiedAdmin,
} from '../../test/helpers/auth-e2e.harness';

/**
 * Systematic access-control coverage beyond auth-security.e2e-spec.ts's
 * existing, incidental sample (one admin-route block, one dealer-route
 * block, one IDOR case on GET /users/:id). This file targets three gaps
 * identified by enumerating every @Roles()/@ResourceOwner()-protected route
 * and every @UseGuards(InternalServiceGuard) controller in this service,
 * rather than testing routes already covered elsewhere again:
 *
 * 1. IDOR on every @ResourceOwner('userId') dealer-profile route - the
 *    concrete mechanism behind the Test Plan's own S1-severity example
 *    ("one dealer able to read or mutate another dealer's listings").
 * 2. InternalServiceGuard rejection on both internal-only controllers
 *    (internal-dealers.controller.ts, internal-users.controller.ts) - proof
 *    an external caller cannot reach a route meant only for service-to-
 *    service calls, regardless of role/JWT.
 */
describe('Access control - IDOR (e2e)', () => {
  let context: AuthE2eContext;

  beforeEach(async () => {
    context = await createAuthE2eApp();
  });

  afterEach(async () => {
    await closeAuthE2eApp(context);
  });

  describe('dealer-profiles ownership', () => {
    async function setUpTwoDealers() {
      await registerAndVerifyDealer(context.agent, 'dealer-a@test.com');
      const dealerA = await login(context.agent, 'dealer-a@test.com');

      await registerAndVerifyDealer(context.agent, 'dealer-b@test.com');
      const dealerB = await login(context.agent, 'dealer-b@test.com');

      return { dealerA, dealerB };
    }

    it('blocks a dealer from reading another dealer profile by id', async () => {
      const { dealerA, dealerB } = await setUpTwoDealers();

      const response = await context.agent
        .get(`/dealer-profiles/${dealerB.user.id}`)
        .set(bearer(dealerA.accessToken))
        .expect(403);

      expect(response.body.message).toBe(
        'You can only access your own resources',
      );
    });

    it('allows a dealer to read their own profile by id', async () => {
      const { dealerA } = await setUpTwoDealers();

      await context.agent
        .get(`/dealer-profiles/${dealerA.user.id}`)
        .set(bearer(dealerA.accessToken))
        .expect(200);
    });

    it('blocks a dealer from updating another dealer profile', async () => {
      const { dealerA, dealerB } = await setUpTwoDealers();

      const response = await context.agent
        .patch(`/dealer-profiles/${dealerB.user.id}`)
        .set(bearer(dealerA.accessToken))
        .send({ businessAddress: '999 Attacker Lane' })
        .expect(403);

      expect(response.body.message).toBe(
        'You can only access your own resources',
      );
    });

    it('blocks a dealer from resubmitting another dealer profile', async () => {
      const { dealerA, dealerB } = await setUpTwoDealers();

      const response = await context.agent
        .patch(`/dealer-profiles/${dealerB.user.id}/resubmit`)
        .set(bearer(dealerA.accessToken))
        .send({
          businessAddress: '999 Attacker Lane',
          city: 'Colombo',
          companyName: 'Hijacked Motors',
          verificationDocuments: { nic: '912345678V' },
        })
        .expect(403);

      expect(response.body.message).toBe(
        'You can only access your own resources',
      );
    });

    it('does not leak dealer B data in the forbidden response body', async () => {
      const { dealerA, dealerB } = await setUpTwoDealers();

      const response = await context.agent
        .get(`/dealer-profiles/${dealerB.user.id}`)
        .set(bearer(dealerA.accessToken))
        .expect(403);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('dealer-b@test.com');
      expect(body).not.toContain('Dealer User');
    });
  });
});

describe('Access control - internal-service-only routes (e2e)', () => {
  let context: AuthE2eContext;

  beforeEach(async () => {
    context = await createAuthE2eApp({
      INTERNAL_SERVICE_KEY: 'test-internal-service-key-32-characters-long',
    });
  });

  afterEach(async () => {
    await closeAuthE2eApp(context);
  });

  describe('internal-dealers', () => {
    const anyDealerId = '00000000-0000-4000-8000-000000000001';
    const body = { adminId: '00000000-0000-4000-8000-000000000099' };

    it('rejects a request with no X-Internal-Service-Key header', async () => {
      await context.agent
        .post(`/internal/dealers/${anyDealerId}/approve`)
        .send(body)
        .expect(401);
    });

    it('rejects a request with the wrong X-Internal-Service-Key', async () => {
      await context.agent
        .post(`/internal/dealers/${anyDealerId}/approve`)
        .set('X-Internal-Service-Key', 'wrong-key')
        .send(body)
        .expect(401);
    });

    it('rejects even a valid admin JWT with no internal key', async () => {
      await seedVerifiedAdmin(context.store, 'admin@test.com');
      // /auth/login explicitly rejects ADMIN-role users (adminOnly: false on
      // that route) - admins authenticate via the separate /auth/login/admin
      // route instead (auth.service.ts's validateCredentials).
      const adminLogin = await context.agent
        .post('/auth/login/admin')
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({ email: 'admin@test.com', password: STRONG_PASSWORD })
        .expect(201);
      const admin = adminLogin.body as { accessToken: string };

      // A real JWT alone must not substitute for the internal-service key -
      // this route is meant for service-to-service calls (admin-service
      // approving/rejecting a dealer), not for any authenticated end user
      // calling auth-user-service directly, however privileged their role.
      await context.agent
        .post(`/internal/dealers/${anyDealerId}/approve`)
        .set(bearer(admin.accessToken))
        .send(body)
        .expect(401);
    });
  });

  describe('internal-users', () => {
    const anyUserId = '00000000-0000-4000-8000-000000000002';
    const body = { adminId: '00000000-0000-4000-8000-000000000099' };

    it('rejects a request with no X-Internal-Service-Key header', async () => {
      await context.agent
        .post(`/internal/users/${anyUserId}/deactivate`)
        .send(body)
        .expect(401);
    });

    it('rejects a request with the wrong X-Internal-Service-Key', async () => {
      await context.agent
        .post(`/internal/users/${anyUserId}/deactivate`)
        .set('X-Internal-Service-Key', 'wrong-key')
        .send(body)
        .expect(401);
    });
  });
});
