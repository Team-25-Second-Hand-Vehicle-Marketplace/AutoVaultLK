import { ConfigService } from '@nestjs/config';
import { getAccessTokenVerifyOptions, getJwtAlgorithm } from '../../../../src/modules/auth/config/jwt.config';

function createConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_ISSUER: 'autovault-lk-auth',
    JWT_AUDIENCE: 'autovault-lk-api',
    JWT_ALGORITHM: 'HS256',
    ...overrides,
  };

  return {
    get: (key: string, defaultValue?: string) => values[key] ?? defaultValue,
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error(`Missing config: ${key}`);
      return values[key];
    },
  } as ConfigService;
}

describe('jwt.config (admin-service)', () => {
  it('verifies with the same issuer, audience, and HS256 as auth', () => {
    const options = getAccessTokenVerifyOptions(createConfig());
    expect(options.issuer).toBe('autovault-lk-auth');
    expect(options.audience).toBe('autovault-lk-api');
    expect(options.algorithms).toEqual(['HS256']);
    expect(options.secret).toBe('a'.repeat(32));
  });

  it('rejects an unsupported JWT algorithm', () => {
    expect(() => getJwtAlgorithm(createConfig({ JWT_ALGORITHM: 'RS256' }))).toThrow(
      'Unsupported JWT algorithm: RS256',
    );
  });
});
