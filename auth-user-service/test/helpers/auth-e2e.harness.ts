import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import request, { Agent } from 'supertest';
import { configureHttpSecurity } from '../../src/common/security/configure-http-security';
import { AUTH_SECURITY_MESSAGES } from '../../src/modules/auth/constants/auth-security.constants';
import { AuthE2eModule } from './auth-e2e.module';
import { IN_MEMORY_STORE, InMemoryAuthStore } from './in-memory-auth-store';

export const STRONG_PASSWORD = 'Str0ngPass';
export const DEFAULT_IP = '127.0.0.1';

export type AuthE2eContext = {
  app: INestApplication;
  module: TestingModule;
  store: InMemoryAuthStore;
  agent: Agent;
};

export async function createAuthE2eApp(
  envOverrides: Record<string, string> = {},
): Promise<AuthE2eContext> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AuthE2eModule.register(envOverrides)],
  }).compile();

  const app = moduleFixture.createNestApplication({ bodyParser: false });
  configureHttpSecurity(app);
  await app.init();

  const store = moduleFixture.get<InMemoryAuthStore>(IN_MEMORY_STORE);
  store.reset();

  return {
    app,
    module: moduleFixture,
    store,
    agent: request(app.getHttpServer()),
  };
}

export async function closeAuthE2eApp(context: AuthE2eContext) {
  await context.app.close();
}

export async function seedVerifiedBuyer(
  store: InMemoryAuthStore,
  email: string,
  password = STRONG_PASSWORD,
  name = 'Verified Buyer',
) {
  return store.saveUser({
    email,
    passwordHash: await bcrypt.hash(password, 4),
    name,
    role: 'BUYER',
    isActive: true,
    emailVerifiedAt: new Date(),
  });
}

export async function seedVerifiedAdmin(
  store: InMemoryAuthStore,
  email: string,
  password = STRONG_PASSWORD,
  name = 'Verified Admin',
) {
  return store.saveUser({
    email,
    passwordHash: await bcrypt.hash(password, 4),
    name,
    role: 'ADMIN',
    isActive: true,
    emailVerifiedAt: new Date(),
  });
}

export async function registerAndVerifyBuyer(
  agent: Agent,
  email: string,
  password = STRONG_PASSWORD,
) {
  const registerResponse = await agent
    .post('/auth/register/buyer')
    .set('X-Forwarded-For', DEFAULT_IP)
    .send({
      email,
      password,
      name: 'Buyer User',
    })
    .expect(201);

  const verificationToken = registerResponse.body.verificationToken as string;
  expect(verificationToken).toBeTruthy();

  await agent
    .post('/auth/email/verify')
    .send({ token: verificationToken })
    .expect(200);

  return registerResponse.body;
}

export async function login(
  agent: Agent,
  email: string,
  password = STRONG_PASSWORD,
) {
  const response = await agent
    .post('/auth/login')
    .set('X-Forwarded-For', DEFAULT_IP)
    .send({ email, password })
    .expect(201);

  return response.body as {
    accessToken: string;
    refreshToken?: string;
    user: { id: string; email: string; role: string };
  };
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function mintExpiredAccessToken() {
  return jwt.sign(
    {
      sub: '00000000-0000-4000-8000-000000000001',
      email: 'expired@test.com',
      role: 'BUYER',
    },
    process.env.JWT_ACCESS_SECRET!,
    {
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
      algorithm: 'HS256',
      expiresIn: -10,
    },
  );
}

export function mintInvalidSignatureAccessToken() {
  return jwt.sign(
    {
      sub: '00000000-0000-4000-8000-000000000002',
      email: 'tampered@test.com',
      role: 'BUYER',
    },
    'wrong-secret-wrong-secret-wrong-secret!!',
    {
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
      algorithm: 'HS256',
      expiresIn: '15m',
    },
  );
}

export function expectNoSensitiveFields(payload: unknown) {
  const json = JSON.stringify(payload);
  expect(json).not.toMatch(/passwordHash|password_hash/i);
  expect(json).not.toMatch(/failedLoginAttempts|failed_login_attempts/i);
  expect(json).not.toMatch(/lockedUntil|locked_until/i);
}

export function expectGenericRegistrationMessage(body: { message?: string }) {
  expect(body.message).toBe(AUTH_SECURITY_MESSAGES.REGISTRATION_RECEIVED);
}

export function expectGenericInvalidCredentials(body: { message?: string }) {
  expect(body.message).toBe(AUTH_SECURITY_MESSAGES.INVALID_CREDENTIALS);
}
