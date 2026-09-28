import { UnauthorizedException } from '@nestjs/common';

const verifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken })),
}));

// Imported after the mock so AuthService picks up the mocked OAuth2Client.
import { AuthService } from '../../src/modules/auth/services/auth.service';

describe('AuthService.loginWithGoogle', () => {
  function makeService() {
    const usersRepository = {
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    const refreshTokensRepository = {
      create: jest.fn().mockResolvedValue(undefined),
      countActiveByUserId: jest.fn().mockResolvedValue(0),
      revokeOldestActiveSessions: jest.fn(),
    };
    const configValues: Record<string, unknown> = {
      GOOGLE_CLIENT_ID: 'test-client-id',
      MAX_ACTIVE_REFRESH_SESSIONS: 5,
      JWT_REFRESH_EXPIRES_IN: '7d',
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_ISSUER: 'test-issuer',
      JWT_AUDIENCE: 'test-audience',
    };
    const configService = {
      get: jest.fn((key: string, fallback?: unknown) => configValues[key] ?? fallback),
      getOrThrow: jest.fn((key: string) => {
        const value = configValues[key];
        if (value === undefined) throw new Error(`Missing config: ${key}`);
        return value;
      }),
    };
    const jwtService = { signAsync: jest.fn().mockResolvedValue('signed-access-token') };

    const service = new AuthService(
      usersRepository as never,
      {} as never,
      refreshTokensRepository as never,
      {} as never,
      {} as never,
      {} as never,
      jwtService as never,
      configService as never,
      {} as never,
    );

    return { service, usersRepository, refreshTokensRepository };
  }

  beforeEach(() => {
    verifyIdToken.mockReset();
  });

  function mockPayload(overrides: Partial<Record<string, unknown>> = {}) {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'new.buyer@test.com',
        email_verified: true,
        name: 'New Buyer',
        sub: 'google-sub-123',
        ...overrides,
      }),
    });
  }

  it('creates a new, already-verified BUYER account on first Google sign-in', async () => {
    const { service, usersRepository } = makeService();
    mockPayload();
    usersRepository.findByEmail.mockResolvedValue(null);
    usersRepository.create.mockImplementation((data) =>
      Promise.resolve({ id: 'user-1', ...data }),
    );

    const result = await service.loginWithGoogle({ idToken: 'raw-google-token' });

    expect(usersRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new.buyer@test.com',
        role: 'BUYER',
        isActive: true,
        emailVerifiedAt: expect.any(Date),
      }),
    );
    expect(result.accessToken).toBe('signed-access-token');
    expect(result.user.email).toBe('new.buyer@test.com');
  });

  it('logs an existing user straight in without creating a duplicate', async () => {
    const { service, usersRepository } = makeService();
    mockPayload({ email: 'existing@test.com' });
    usersRepository.findByEmail.mockResolvedValue({
      id: 'user-2',
      email: 'existing@test.com',
      name: 'Existing',
      role: 'BUYER',
      isActive: true,
      emailVerifiedAt: new Date('2026-01-01'),
    });

    const result = await service.loginWithGoogle({ idToken: 'raw-google-token' });

    expect(usersRepository.create).not.toHaveBeenCalled();
    expect(result.user.email).toBe('existing@test.com');
  });

  it('verifies and activates a previously unverified account via Google', async () => {
    const { service, usersRepository } = makeService();
    mockPayload({ email: 'pending@test.com' });
    usersRepository.findByEmail.mockResolvedValue({
      id: 'user-3',
      email: 'pending@test.com',
      name: 'Pending',
      role: 'BUYER',
      isActive: false,
      emailVerifiedAt: null,
    });
    usersRepository.update.mockImplementation((id, patch) =>
      Promise.resolve({
        id,
        email: 'pending@test.com',
        name: 'Pending',
        role: 'BUYER',
        isActive: true,
        emailVerifiedAt: new Date(),
        ...patch,
      }),
    );

    await service.loginWithGoogle({ idToken: 'raw-google-token' });

    expect(usersRepository.update).toHaveBeenCalledWith(
      'user-3',
      expect.objectContaining({ isActive: true, emailVerifiedAt: expect.any(Date) }),
    );
  });

  it('rejects an ADMIN account signing in through Google', async () => {
    const { service, usersRepository } = makeService();
    mockPayload({ email: 'admin@test.com' });
    usersRepository.findByEmail.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@test.com',
      role: 'ADMIN',
      isActive: true,
      emailVerifiedAt: new Date(),
    });

    await expect(service.loginWithGoogle({ idToken: 'raw-google-token' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a Google account with an unverified email', async () => {
    const { service } = makeService();
    mockPayload({ email_verified: false });

    await expect(service.loginWithGoogle({ idToken: 'raw-google-token' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token that fails Google verification', async () => {
    const { service } = makeService();
    verifyIdToken.mockRejectedValue(new Error('Wrong number of segments in token'));

    await expect(service.loginWithGoogle({ idToken: 'garbage' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
