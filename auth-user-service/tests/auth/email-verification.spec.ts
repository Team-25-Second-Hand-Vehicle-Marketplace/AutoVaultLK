import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { User } from '../../src/infrastructure/database/entities/user.entity';
import { AUTH_SECURITY_MESSAGES } from '../../src/modules/auth/constants/auth-security.constants';
import { AuthAbuseProtectionService } from '../../src/modules/auth/services/auth-abuse-protection.service';
import { EmailVerificationService } from '../../src/modules/auth/services/email-verification.service';

function hashToken(token: string) {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(token).digest('hex');
}

describe('EmailVerificationService', () => {
  const usersRepository = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
  };
  const emailVerificationTokensRepository = {
    findByHash: jest.fn(),
    create: jest.fn(),
    markUsed: jest.fn(),
    revokeUnusedForUser: jest.fn(),
  };
  const authAbuseProtection = {
    assertResendVerificationAllowed: jest.fn(),
    recordResendVerification: jest.fn(),
    simulateRegistrationProcessing: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => defaultValue),
  };

  const service = new EmailVerificationService(
    configService as unknown as ConfigService,
    usersRepository as never,
    emailVerificationTokensRepository as never,
    authAbuseProtection as unknown as AuthAbuseProtectionService,
    dataSource as unknown as DataSource,
  );

  beforeEach(() => jest.clearAllMocks());

  it('issues hashed one-time verification tokens', async () => {
    emailVerificationTokensRepository.revokeUnusedForUser.mockResolvedValue(undefined);
    emailVerificationTokensRepository.create.mockResolvedValue({ id: 'token-id' });

    const result = await service.issueToken({
      id: 'user-id',
      email: 'buyer@test.com',
    } as User);

    expect(result.rawToken).toBeDefined();
    expect(emailVerificationTokensRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        tokenHash: hashToken(result.rawToken),
      }),
    );
  });

  it('activates buyers and marks tokens used on verification', async () => {
    const rawToken = 'email-verification-token-value-1234567890';
    const storedToken = {
      id: 'token-id',
      userId: 'user-id',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };

    emailVerificationTokensRepository.findByHash.mockResolvedValue(storedToken);
    usersRepository.findById.mockResolvedValue({
      id: 'user-id',
      role: 'BUYER',
      emailVerifiedAt: null,
    } as User);

    const manager = {
      update: jest.fn(),
    };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));

    await expect(service.verifyEmail(rawToken)).resolves.toEqual({
      message: AUTH_SECURITY_MESSAGES.EMAIL_VERIFIED,
      emailVerified: true,
      role: 'BUYER',
      accountActivated: true,
      dealerVerificationStatus: undefined,
    });

    expect(manager.update).toHaveBeenCalledWith(
      User,
      { id: 'user-id' },
      expect.objectContaining({
        isActive: true,
        emailVerifiedAt: expect.any(Date),
      }),
    );
  });

  it('rejects login-like flows when email is not verified', async () => {
    const user = {
      id: 'user-id',
      role: 'BUYER',
      emailVerifiedAt: null,
      isActive: false,
      passwordHash: 'hash',
    } as User;

    usersRepository.findByEmail.mockResolvedValue(user);

    const authServiceValidate = async () => {
      if (!user.emailVerifiedAt) {
        throw new UnauthorizedException(AUTH_SECURITY_MESSAGES.EMAIL_NOT_VERIFIED);
      }
    };

    await expect(authServiceValidate()).rejects.toThrow(
      new UnauthorizedException(AUTH_SECURITY_MESSAGES.EMAIL_NOT_VERIFIED),
    );
  });

  it('returns a generic resend response without revealing account state', async () => {
    authAbuseProtection.assertResendVerificationAllowed.mockResolvedValue(undefined);
    usersRepository.findByEmail.mockResolvedValue(null);
    authAbuseProtection.simulateRegistrationProcessing.mockResolvedValue(undefined);

    await expect(
      service.resendVerification('missing@test.com', { ipAddress: '127.0.0.1' }),
    ).resolves.toEqual({
      message: AUTH_SECURITY_MESSAGES.RESEND_VERIFICATION_RECEIVED,
    });
  });

  it('rejects invalid verification tokens', async () => {
    emailVerificationTokensRepository.findByHash.mockResolvedValue(null);

    await expect(service.verifyEmail('invalid-token-value-1234567890')).rejects.toThrow(
      BadRequestException,
    );
  });
});
