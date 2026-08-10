import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import {
  getAccessTokenSignOptions,
  getAccessTokenVerifyOptions,
} from '../../src/modules/auth/config/jwt.config';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';

function createConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_ISSUER: 'autovault-lk-auth',
    JWT_AUDIENCE: 'autovault-lk-api',
    JWT_ALGORITHM: 'HS256',
    JWT_ACCESS_EXPIRES_IN: '15m',
    ...overrides,
  };

  return {
    get: (key: string, defaultValue?: string) =>
      values[key] ?? defaultValue,
    getOrThrow: (key: string) => {
      if (!(key in values)) {
        throw new Error(`Missing config: ${key}`);
      }
      return values[key];
    },
  } as ConfigService;
}

describe('jwt.config', () => {
  it('includes issuer, audience, and algorithm in sign options', () => {
    const config = createConfig();
    const options = getAccessTokenSignOptions(config);

    expect(options.issuer).toBe('autovault-lk-auth');
    expect(options.audience).toBe('autovault-lk-api');
    expect(options.algorithm).toBe('HS256');
    expect(options.secret).toBe('a'.repeat(32));
  });

  it('includes issuer, audience, and algorithms in verify options', () => {
    const config = createConfig();
    const options = getAccessTokenVerifyOptions(config);

    expect(options.issuer).toBe('autovault-lk-auth');
    expect(options.audience).toBe('autovault-lk-api');
    expect(options.algorithms).toEqual(['HS256']);
  });
});

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard();

  it('maps expired tokens to a clear 401 message', () => {
    expect(() =>
      guard.handleRequest(null, null, new TokenExpiredError('jwt expired', new Date())),
    ).toThrow(new UnauthorizedException('Access token has expired'));
  });

  it('maps invalid tokens to a clear 401 message', () => {
    expect(() =>
      guard.handleRequest(null, null, new JsonWebTokenError('invalid token')),
    ).toThrow(new UnauthorizedException('Invalid access token'));
  });

  it('requires an authenticated user', () => {
    expect(() => guard.handleRequest(null, null, undefined)).toThrow(
      new UnauthorizedException('Authentication required'),
    );
  });
});
