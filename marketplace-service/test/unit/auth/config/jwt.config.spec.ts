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

describe('jwt.config', () => {
  it('verifies with the same issuer, audience, and HS256 as auth-user-service (SAD 3.5.1)', () => {
    const options = getAccessTokenVerifyOptions(createConfig());
    expect(options.issuer).toBe('autovault-lk-auth');
    expect(options.audience).toBe('autovault-lk-api');
    expect(options.algorithms).toEqual(['HS256']);
    expect(options.secret).toBe('a'.repeat(32));
  });

  it('defaults the algorithm to HS256 when unset', () => {
    expect(getJwtAlgorithm(createConfig({ JWT_ALGORITHM: undefined as never }))).toBe('HS256');
  });

  it('rejects an unsupported JWT algorithm', () => {
    expect(() => getJwtAlgorithm(createConfig({ JWT_ALGORITHM: 'RS256' }))).toThrow(
      'Unsupported JWT algorithm: RS256',
    );
  });

  it('throws when a required config value is missing', () => {
    const config = createConfig();
    (config.getOrThrow as jest.Mock) = jest.fn(() => {
      throw new Error('Missing config: JWT_ACCESS_SECRET');
    });
    expect(() => getAccessTokenVerifyOptions(config)).toThrow('Missing config: JWT_ACCESS_SECRET');
  });
});
