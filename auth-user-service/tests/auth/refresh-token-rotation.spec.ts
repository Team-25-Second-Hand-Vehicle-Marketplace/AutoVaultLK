import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../../src/infrastructure/database/entities/refresh-token.entity';
import { User } from '../../src/infrastructure/database/entities/user.entity';
import { AuthService } from '../../src/modules/auth/services/auth.service';

function hashToken(token: string) {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(token).digest('hex');
}

describe('AuthService refresh token rotation', () => {
  const usersRepository = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    create: jest.fn(),
  };
  const dealerProfilesRepository = {
    findByUserId: jest.fn(),
  };
  const refreshTokensRepository = {
    findByHash: jest.fn(),
    findActiveByHash: jest.fn(),
    create: jest.fn(),
    revoke: jest.fn(),
    revokeFamily: jest.fn(),
    countActiveByUserId: jest.fn(),
    revokeOldestActiveSessions: jest.fn(),
    revokeAllActiveForUser: jest.fn(),
  };
  const authAbuseProtection = {
    assertRefreshAllowed: jest.fn(),
    recordRefreshFailure: jest.fn().mockImplementation(() => {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }),
    recordRefreshSuccess: jest.fn(),
    preLoginCheck: jest.fn(),
    handleFailedLogin: jest.fn(),
    recordLoginSuccess: jest.fn(),
    assertRegistrationAllowed: jest.fn(),
    recordRegistrationAttempt: jest.fn(),
    simulateRegistrationProcessing: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('access-token'),
  };
  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const values: Record<string, unknown> = {
        JWT_REFRESH_EXPIRES_IN: '7d',
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_ISSUER: 'autovault-lk-auth',
        JWT_AUDIENCE: 'autovault-lk-api',
        JWT_ALGORITHM: 'HS256',
        JWT_ACCESS_EXPIRES_IN: '15m',
        MAX_ACTIVE_REFRESH_SESSIONS: 5,
      };
      return values[key] ?? defaultValue;
    }),
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_ISSUER: 'autovault-lk-auth',
        JWT_AUDIENCE: 'autovault-lk-api',
      };
      return values[key];
    }),
  };
  const dataSource = {
    transaction: jest.fn(),
  };

  const service = new AuthService(
    usersRepository as never,
    dealerProfilesRepository as never,
    refreshTokensRepository as never,
    authAbuseProtection as never,
    jwtService as never,
    configService as unknown as ConfigService,
    dataSource as unknown as DataSource,
  );

  const activeUser = {
    id: 'user-id',
    email: 'user@test.com',
    name: 'User',
    role: 'BUYER',
    isActive: true,
  } as User;

  beforeEach(() => {
    jest.clearAllMocks();
    usersRepository.findById.mockResolvedValue(activeUser);
  });

  it('revokes the token family when a revoked refresh token is reused', async () => {
    const refreshToken = 'reused-refresh-token-value-1234567890';
    refreshTokensRepository.findByHash.mockResolvedValue({
      id: 'token-id',
      userId: 'user-id',
      familyId: 'family-id',
      tokenHash: hashToken(refreshToken),
      revokedAt: new Date('2026-08-01T00:00:00.000Z'),
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    } as RefreshToken);

    await expect(
      service.refresh({ refreshToken }),
    ).rejects.toThrow(
      new UnauthorizedException(
        'Invalid or expired refresh token',
      ),
    );

    expect(refreshTokensRepository.revokeFamily).toHaveBeenCalledWith('family-id');
    expect(authAbuseProtection.recordRefreshFailure).toHaveBeenCalled();
  });

  it('rotates refresh tokens atomically inside a transaction', async () => {
    const refreshToken = 'active-refresh-token-value-1234567890';
    const storedToken = {
      id: 'token-id',
      userId: 'user-id',
      familyId: 'family-id',
      tokenHash: hashToken(refreshToken),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: 'jest-agent',
      ipAddress: '127.0.0.1',
      deviceLabel: 'Test Device',
    } as RefreshToken;

    refreshTokensRepository.findByHash.mockResolvedValue(storedToken);

    const lockedToken = { ...storedToken };
    const manager = {
      findOne: jest.fn().mockResolvedValue(lockedToken),
      create: jest.fn((_entity, data) => data),
      save: jest
        .fn()
        .mockImplementationOnce(async (token) => ({ ...token, id: 'new-token-id' }))
        .mockImplementationOnce(async (token) => token),
      update: jest.fn(),
    };

    dataSource.transaction.mockImplementation(async (callback) =>
      callback(manager),
    );

    const result = await service.refresh(
      { refreshToken, deviceLabel: 'Updated Device' },
      { ipAddress: '10.0.0.1' },
    );

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBeDefined();
    expect(result.refreshToken).not.toBe(refreshToken);
    expect(lockedToken.revokedAt).toBeInstanceOf(Date);
    expect(lockedToken.replacedById).toBe('new-token-id');
    expect(manager.create).toHaveBeenCalledWith(
      RefreshToken,
      expect.objectContaining({
        familyId: 'family-id',
        userId: 'user-id',
        ipAddress: '10.0.0.1',
        deviceLabel: 'Updated Device',
      }),
    );
  });

  it('revokes all active sessions for logout-all', async () => {
    await expect(service.logoutAllSessions('user-id')).resolves.toEqual({
      success: true,
    });

    expect(refreshTokensRepository.revokeAllActiveForUser).toHaveBeenCalledWith(
      'user-id',
    );
  });

  it('enforces the maximum active session limit on login', async () => {
    authAbuseProtection.preLoginCheck.mockResolvedValue(undefined);
    authAbuseProtection.recordLoginSuccess.mockResolvedValue(undefined);
    usersRepository.findByEmail.mockResolvedValue({
      ...activeUser,
      passwordHash: '$2a$12$hashed-password-placeholder-value',
    });

    const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    refreshTokensRepository.countActiveByUserId.mockResolvedValue(5);
    refreshTokensRepository.create.mockResolvedValue({ id: 'new-session' });

    await service.login({ email: 'user@test.com', password: 'secret' });

    expect(refreshTokensRepository.revokeOldestActiveSessions).toHaveBeenCalledWith(
      'user-id',
      1,
    );
    expect(refreshTokensRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        familyId: expect.any(String),
        userAgent: null,
      }),
    );
  });
});
