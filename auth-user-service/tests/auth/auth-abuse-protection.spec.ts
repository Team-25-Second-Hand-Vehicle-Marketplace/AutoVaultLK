import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUTH_SECURITY_MESSAGES,
  SecurityEventType,
} from '../../src/modules/auth/constants/auth-security.constants';
import { AuthAbuseProtectionService } from '../../src/modules/auth/services/auth-abuse-protection.service';

describe('AuthAbuseProtectionService', () => {
  const securityEventsRepository = {
    record: jest.fn(),
    countRecentByIp: jest.fn(),
    countRecentByEmail: jest.fn(),
    countRecentFailuresByEmail: jest.fn(),
  };
  const usersRepository = {
    findByEmail: jest.fn(),
    recordFailedLogin: jest.fn(),
    clearLoginFailures: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => defaultValue),
    getOrThrow: jest.fn(),
  };

  const service = new AuthAbuseProtectionService(
    configService as unknown as ConfigService,
    securityEventsRepository as never,
    usersRepository as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('audits and throws a generic message on failed login', async () => {
    usersRepository.findByEmail.mockResolvedValue({
      id: 'user-id',
      failedLoginAttempts: 1,
      lockedUntil: null,
    });
    usersRepository.recordFailedLogin.mockResolvedValue({
      failedLoginAttempts: 2,
      lockedUntil: null,
    });

    await expect(
      service.handleFailedLogin(
        'user@test.com',
        { ipAddress: '127.0.0.1', userAgent: 'jest' },
        SecurityEventType.LOGIN,
      ),
    ).rejects.toThrow(
      new UnauthorizedException(AUTH_SECURITY_MESSAGES.INVALID_CREDENTIALS),
    );

    expect(securityEventsRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SecurityEventType.LOGIN,
        email: 'user@test.com',
        success: false,
        failureReason: 'invalid_credentials',
      }),
    );
  });

  it('returns the same password reset response regardless of account existence', async () => {
    securityEventsRepository.countRecentByIp.mockResolvedValue(0);
    securityEventsRepository.countRecentByEmail.mockResolvedValue(0);
    jest
      .spyOn(service, 'simulateRegistrationProcessing')
      .mockResolvedValue(undefined);

    await expect(
      service.recordPasswordResetRequest(
        'missing@test.com',
        { ipAddress: '127.0.0.1' },
        null,
      ),
    ).resolves.toEqual({
      message: AUTH_SECURITY_MESSAGES.PASSWORD_RESET_RECEIVED,
    });
  });

  it('blocks locked accounts before credential validation', async () => {
    securityEventsRepository.countRecentByIp.mockResolvedValue(0);
    usersRepository.findByEmail.mockResolvedValue({
      id: 'user-id',
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 60_000),
    });

    await expect(
      service.preLoginCheck(
        'user@test.com',
        { ipAddress: '127.0.0.1' },
        SecurityEventType.LOGIN,
      ),
    ).rejects.toThrow(
      new HttpException(
        AUTH_SECURITY_MESSAGES.TOO_MANY_ATTEMPTS,
        429,
      ),
    );
  });
});
