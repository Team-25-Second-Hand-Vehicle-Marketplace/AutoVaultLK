import { AUTH_SECURITY_MESSAGES } from '../../src/modules/auth/constants/auth-security.constants';
import {
  CSRF_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from '../../src/config/http-security.config';
import {
  AuthE2eContext,
  DEFAULT_IP,
  STRONG_PASSWORD,
  bearer,
  closeAuthE2eApp,
  createAuthE2eApp,
  expectGenericInvalidCredentials,
  expectGenericRegistrationMessage,
  expectNoSensitiveFields,
  login,
  mintExpiredAccessToken,
  mintInvalidSignatureAccessToken,
  registerAndVerifyBuyer,
  seedVerifiedBuyer,
} from '../../test/helpers/auth-e2e.harness';

describe('Auth security (e2e)', () => {
  let context: AuthE2eContext;

  beforeEach(async () => {
    context = await createAuthE2eApp();
  });

  afterEach(async () => {
    await closeAuthE2eApp(context);
  });

  describe('request validation', () => {
    it('rejects weak passwords on buyer registration', async () => {
      const response = await context.agent
        .post('/auth/register/buyer')
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({
          email: 'weak@test.com',
          password: 'weak',
          name: 'Buyer User',
        })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toBe('One or more fields failed validation');
    });

    it('rejects privileged fields on buyer registration', async () => {
      const response = await context.agent
        .post('/auth/register/buyer')
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({
          email: 'privileged@test.com',
          password: STRONG_PASSWORD,
          name: 'Buyer User',
          role: 'ADMIN',
          isActive: true,
          passwordHash: 'hack',
        })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toBe('One or more fields failed validation');
    });
  });

  describe('registration abuse protection', () => {
    it('returns the same generic response for duplicate email registration', async () => {
      const email = 'duplicate-buyer@test.com';

      const first = await context.agent
        .post('/auth/register/buyer')
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({
          email,
          password: STRONG_PASSWORD,
          name: 'Buyer User',
        })
        .expect(201);

      expectGenericRegistrationMessage(first.body);
      expectNoSensitiveFields(first.body);

      const second = await context.agent
        .post('/auth/register/buyer')
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({
          email,
          password: STRONG_PASSWORD,
          name: 'Another Buyer',
        })
        .expect(201);

      expectGenericRegistrationMessage(second.body);
      expect(second.body).toEqual(
        expect.objectContaining({
          message: first.body.message,
        }),
      );
      expect(second.body).not.toHaveProperty('user');
    });
  });

  describe('login', () => {
    it('returns a generic message for invalid credentials', async () => {
      await registerAndVerifyBuyer(context.agent, 'login-user@test.com');

      const response = await context.agent
        .post('/auth/login')
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({
          email: 'login-user@test.com',
          password: 'WrongPass1',
        })
        .expect(401);

      expectGenericInvalidCredentials(response.body);
      expectNoSensitiveFields(response.body);
    });
  });

  describe('JWT access control', () => {
    it('rejects expired access tokens', async () => {
      const response = await context.agent
        .get('/users/me')
        .set(bearer(mintExpiredAccessToken()))
        .expect(401);

      expect(response.body.message).toBe('Access token has expired');
    });

    it('rejects access tokens with invalid signatures', async () => {
      const response = await context.agent
        .get('/users/me')
        .set(bearer(mintInvalidSignatureAccessToken()))
        .expect(401);

      expect(response.body.message).toBe('Invalid access token');
    });

    it('rejects requests without a JWT', async () => {
      const response = await context.agent.get('/users/me').expect(401);

      expect(response.body.message).toBe('Authentication required');
    });
  });

  describe('roles and ownership', () => {
    it('blocks buyers from admin-only routes', async () => {
      await registerAndVerifyBuyer(context.agent, 'buyer-rbac@test.com');
      const session = await login(context.agent, 'buyer-rbac@test.com');

      const response = await context.agent
        .get('/users')
        .set(bearer(session.accessToken))
        .expect(403);

      expect(response.body.message).toBe(
        'Insufficient permissions for this action',
      );
    });

    it('blocks buyers from dealer-only routes', async () => {
      await registerAndVerifyBuyer(context.agent, 'buyer-dealer@test.com');
      const session = await login(context.agent, 'buyer-dealer@test.com');

      const response = await context.agent
        .get('/dealer-profiles/me')
        .set(bearer(session.accessToken))
        .expect(403);

      expect(response.body.message).toBe(
        'Insufficient permissions for this action',
      );
    });

    it('blocks users from accessing another users profile', async () => {
      await registerAndVerifyBuyer(context.agent, 'owner-a@test.com');
      const ownerA = await login(context.agent, 'owner-a@test.com');

      const ownerB = await seedVerifiedBuyer(
        context.store,
        'owner-b@test.com',
      );

      const response = await context.agent
        .get(`/users/${ownerB.id}`)
        .set(bearer(ownerA.accessToken))
        .expect(403);

      expect(response.body.message).toBe(
        'You can only access your own resources',
      );
    });
  });

  describe('refresh-token hardening', () => {
    it('revokes a refresh-token family when a rotated token is reused', async () => {
      await registerAndVerifyBuyer(context.agent, 'refresh-user@test.com');
      const session = await login(context.agent, 'refresh-user@test.com');
      const originalRefreshToken = session.refreshToken;
      expect(originalRefreshToken).toBeTruthy();

      const rotated = await context.agent
        .post('/auth/refresh')
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({ refreshToken: originalRefreshToken })
        .expect(201);

      expect(rotated.body.refreshToken).toBeTruthy();
      expect(rotated.body.refreshToken).not.toBe(originalRefreshToken);

      const reuse = await context.agent
        .post('/auth/refresh')
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({ refreshToken: originalRefreshToken })
        .expect(401);

      expect(reuse.body.message).toBe(
        AUTH_SECURITY_MESSAGES.INVALID_REFRESH_TOKEN,
      );

      const secondReuse = await context.agent
        .post('/auth/refresh')
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);

      expect(secondReuse.body.message).toBe(
        AUTH_SECURITY_MESSAGES.INVALID_REFRESH_TOKEN,
      );
    });
  });

  describe('password reset', () => {
    it('rejects password reset token reuse', async () => {
      await registerAndVerifyBuyer(context.agent, 'reset-user@test.com');

      const resetRequest = await context.agent
        .post('/auth/password-reset/request')
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({ email: 'reset-user@test.com' })
        .expect(200);

      const resetToken = resetRequest.body.resetToken as string;
      expect(resetToken).toBeTruthy();

      await context.agent
        .post('/auth/password-reset/confirm')
        .send({
          token: resetToken,
          newPassword: 'NewStr0ngPass',
        })
        .expect(200);

      const reuse = await context.agent
        .post('/auth/password-reset/confirm')
        .send({
          token: resetToken,
          newPassword: 'AnotherStr0ng1',
        })
        .expect(400);

      expect(reuse.body.message).toBe(AUTH_SECURITY_MESSAGES.INVALID_RESET_TOKEN);
    });
  });

  describe('response hygiene', () => {
    it('never exposes sensitive fields in auth and profile responses', async () => {
      await registerAndVerifyBuyer(context.agent, 'hygiene@test.com');
      const session = await login(context.agent, 'hygiene@test.com');

      expectNoSensitiveFields(session);
      expect(session.user).toBeTruthy();

      const profile = await context.agent
        .get('/users/me')
        .set(bearer(session.accessToken))
        .expect(200);

      expectNoSensitiveFields(profile.body);
    });
  });
});

describe('Auth security rate limits (e2e)', () => {
  it('rate-limits repeated failed login attempts per IP', async () => {
    const context = await createAuthE2eApp({
      AUTH_IP_MAX_ATTEMPTS: '3',
      AUTH_LOGIN_MAX_ATTEMPTS: '100',
      AUTH_PROGRESSIVE_DELAY_BASE_MS: '0',
      AUTH_PROGRESSIVE_DELAY_MAX_MS: '0',
    });

    try {
      await registerAndVerifyBuyer(context.agent, 'locked-user@test.com');

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await context.agent
          .post('/auth/login')
          .set('X-Forwarded-For', '198.51.100.10')
          .send({
            email: 'locked-user@test.com',
            password: 'WrongPass1',
          })
          .expect(401);
      }

      const blocked = await context.agent
        .post('/auth/login')
        .set('X-Forwarded-For', '198.51.100.10')
        .send({
          email: 'locked-user@test.com',
          password: 'WrongPass1',
        })
        .expect(429);

      expect(blocked.body.message).toBe(AUTH_SECURITY_MESSAGES.TOO_MANY_ATTEMPTS);
    } finally {
      await closeAuthE2eApp(context);
    }
  });

  it('rate-limits duplicate registration attempts per IP', async () => {
    const context = await createAuthE2eApp({
      AUTH_REGISTER_MAX_PER_IP: '2',
      AUTH_PROGRESSIVE_DELAY_BASE_MS: '0',
      AUTH_PROGRESSIVE_DELAY_MAX_MS: '0',
    });

    try {
      const registerDuplicate = () =>
        context.agent
          .post('/auth/register/buyer')
          .set('X-Forwarded-For', '203.0.113.50')
          .send({
            email: 'rate-limit@test.com',
            password: STRONG_PASSWORD,
            name: 'Buyer User',
          });

      await registerDuplicate().expect(201);
      await registerDuplicate().expect(201);
      await registerDuplicate().expect(201);

      const blocked = await registerDuplicate().expect(429);
      expect(blocked.body.message).toBe(AUTH_SECURITY_MESSAGES.TOO_MANY_ATTEMPTS);
    } finally {
      await closeAuthE2eApp(context);
    }
  });
});

describe('Auth secure token transport (e2e)', () => {
  it('omits refresh tokens from JSON when cookie transport is enabled', async () => {
    const context = await createAuthE2eApp({
      AUTH_USE_REFRESH_COOKIES: 'true',
      AUTH_REFRESH_TOKEN_IN_BODY: 'false',
    });

    try {
      await registerAndVerifyBuyer(context.agent, 'cookie-user@test.com');

      const response = await context.agent
        .post('/auth/login')
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({
          email: 'cookie-user@test.com',
          password: STRONG_PASSWORD,
        })
        .expect(201);

      expect(response.body.accessToken).toBeTruthy();
      expect(response.body).not.toHaveProperty('refreshToken');
      expectNoSensitiveFields(response.body);

      const cookies = response.headers['set-cookie'] as string[];
      expect(cookies.some((cookie) => cookie.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`))).toBe(true);
      expect(cookies.some((cookie) => cookie.startsWith(`${CSRF_TOKEN_COOKIE_NAME}=`))).toBe(true);
    } finally {
      await closeAuthE2eApp(context);
    }
  });

  it('requires CSRF protection for cookie-based refresh requests', async () => {
    const context = await createAuthE2eApp({
      AUTH_USE_REFRESH_COOKIES: 'true',
      AUTH_REFRESH_TOKEN_IN_BODY: 'false',
    });

    try {
      await registerAndVerifyBuyer(context.agent, 'csrf-user@test.com');

      const loginResponse = await context.agent
        .post('/auth/login')
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({
          email: 'csrf-user@test.com',
          password: STRONG_PASSWORD,
        })
        .expect(201);

      const cookies = loginResponse.headers['set-cookie'] as string[];
      const cookieHeader = cookies.map((cookie) => cookie.split(';')[0]).join('; ');

      const blocked = await context.agent
        .post('/auth/refresh')
        .set('Cookie', cookieHeader)
        .set('X-Forwarded-For', DEFAULT_IP)
        .send({})
        .expect(403);

      expect(blocked.body.message).toBe('Invalid CSRF token');
    } finally {
      await closeAuthE2eApp(context);
    }
  });
});
