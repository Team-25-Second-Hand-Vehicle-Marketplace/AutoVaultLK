import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../../src/infrastructure/database/entities/user.entity';
import { AUTH_SECURITY_MESSAGES } from '../../src/modules/auth/constants/auth-security.constants';
import { PasswordService } from '../../src/modules/auth/services/password.service';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

function hashToken(token: string) {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(token).digest('hex');
}

describe('PasswordService', () => {
  const usersRepository = {
    findById: jest.fn(),
    clearLoginFailures: jest.fn(),
  };
  const passwordResetTokensRepository = {
    findByHash: jest.fn(),
    create: jest.fn(),
    revokeUnusedForUser: jest.fn(),
  };
  const passwordHistoryRepository = {
    findRecentForUser: jest.fn().mockResolvedValue([]),
    trimToLimit: jest.fn(),
  };
  const refreshTokensRepository = {
    revokeAllActiveForUser: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => defaultValue),
  };

  const service = new PasswordService(
    configService as unknown as ConfigService,
    usersRepository as never,
    passwordResetTokensRepository as never,
    passwordHistoryRepository as never,
    refreshTokensRepository as never,
    dataSource as unknown as DataSource,
  );

  const user = {
    id: 'user-id',
    email: 'user@test.com',
    passwordHash: '$2a$12$oldhasholdhasholdhasholdhasholdhasholdha',
  } as User;

  const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedBcrypt.hash.mockResolvedValue('new-hash' as never);
    mockedBcrypt.compare.mockResolvedValue(false as never);
  });

  it('issues hashed reset tokens', async () => {
    passwordResetTokensRepository.revokeUnusedForUser.mockResolvedValue(undefined);
    passwordResetTokensRepository.create.mockResolvedValue({ id: 'token-id' });

    const result = await service.issueResetToken(user);

    expect(passwordResetTokensRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        tokenHash: hashToken(result.rawToken),
      }),
    );
  });

  it('returns the same forgot-password response when the email is unknown', async () => {
    await expect(service.requestResetResponse(null)).resolves.toEqual({
      message: AUTH_SECURITY_MESSAGES.PASSWORD_RESET_RECEIVED,
    });
  });

  it('rejects password reuse on change', async () => {
    usersRepository.findById.mockResolvedValue(user);
    mockedBcrypt.compare
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(true as never);

    await expect(
      service.changePassword('user-id', 'CurrentPass1', 'CurrentPass1'),
    ).rejects.toThrow(
      new BadRequestException(AUTH_SECURITY_MESSAGES.PASSWORD_REUSED),
    );
  });

  it('revokes all refresh sessions after a successful password reset', async () => {
    const rawToken = 'password-reset-token-value-1234567890';
    const storedToken = {
      id: 'token-id',
      userId: 'user-id',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };

    passwordResetTokensRepository.findByHash.mockResolvedValue(storedToken);
    usersRepository.findById.mockResolvedValue(user);

    const manager = {
      save: jest.fn(),
      update: jest.fn(),
      create: jest.fn((_entity, data) => data),
    };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));

    await expect(
      service.confirmReset(rawToken, 'BrandNewPass1'),
    ).resolves.toEqual({
      message: AUTH_SECURITY_MESSAGES.PASSWORD_RESET_COMPLETE,
    });

    expect(refreshTokensRepository.revokeAllActiveForUser).toHaveBeenCalledWith(
      'user-id',
    );
    expect(usersRepository.clearLoginFailures).toHaveBeenCalledWith('user-id');
  });

  it('rejects password change when the current password is wrong', async () => {
    usersRepository.findById.mockResolvedValue(user);
    mockedBcrypt.compare.mockResolvedValueOnce(false as never);

    await expect(
      service.changePassword('user-id', 'wrong-password', 'BrandNewPass1'),
    ).rejects.toThrow(
      new UnauthorizedException(AUTH_SECURITY_MESSAGES.CURRENT_PASSWORD_INCORRECT),
    );
  });
});
