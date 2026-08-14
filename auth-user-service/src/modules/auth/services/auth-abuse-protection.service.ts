import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersRepository } from '../../users/repositories/users.repository';
import {
  AUTH_SECURITY_MESSAGES,
  SecurityEventType,
} from '../constants/auth-security.constants';
import { SecurityEventsRepository } from '../repositories/security-events.repository';
import { SessionMetadata } from '../types/session-metadata.type';

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}

@Injectable()
export class AuthAbuseProtectionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly securityEventsRepository: SecurityEventsRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async preLoginCheck(
    email: string,
    session: SessionMetadata,
    eventType: typeof SecurityEventType.LOGIN | typeof SecurityEventType.ADMIN_LOGIN,
  ) {
    await this.assertIpRateLimit(eventType, session.ipAddress);

    const user = await this.usersRepository.findByEmail(email);
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.applyProgressiveDelay(user.failedLoginAttempts ?? 0);
      await this.securityEventsRepository.record({
        eventType,
        email,
        userId: user.id,
        ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
        success: false,
        failureReason: 'account_locked',
      });
      throw new HttpException(
        AUTH_SECURITY_MESSAGES.TOO_MANY_ATTEMPTS,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async handleFailedLogin(
    email: string,
    session: SessionMetadata,
    eventType: typeof SecurityEventType.LOGIN | typeof SecurityEventType.ADMIN_LOGIN,
    failureReason = 'invalid_credentials',
  ): Promise<never> {
    const user = await this.usersRepository.findByEmail(email);
    let attemptCount = 0;

    if (user) {
      const updated = await this.usersRepository.recordFailedLogin(
        user.id,
        this.getLoginMaxAttempts(),
        this.getLoginLockoutMinutes(),
      );
      attemptCount = updated.failedLoginAttempts ?? 0;
    } else {
      const since = this.windowStart(this.getLoginWindowMinutes());
      attemptCount = await this.securityEventsRepository.countRecentFailuresByEmail(
        [SecurityEventType.LOGIN, SecurityEventType.ADMIN_LOGIN],
        email,
        since,
      );
      attemptCount += 1;
    }

    await this.applyProgressiveDelay(attemptCount);
    await this.securityEventsRepository.record({
      eventType,
      email,
      userId: user?.id ?? null,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
      success: false,
      failureReason,
    });

    if (user && user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        AUTH_SECURITY_MESSAGES.TOO_MANY_ATTEMPTS,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    throw new UnauthorizedException(AUTH_SECURITY_MESSAGES.INVALID_CREDENTIALS);
  }

  async recordLoginSuccess(
    email: string,
    session: SessionMetadata,
    eventType: typeof SecurityEventType.LOGIN | typeof SecurityEventType.ADMIN_LOGIN,
    userId: string,
  ) {
    await this.usersRepository.clearLoginFailures(userId);
    await this.securityEventsRepository.record({
      eventType,
      email,
      userId,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
      success: true,
    });
  }

  async assertRegistrationAllowed(session: SessionMetadata) {
    const since = this.windowStart(this.getRegisterWindowMinutes());
    const attempts = await this.securityEventsRepository.countRecentByIp(
      SecurityEventType.REGISTER_BUYER,
      session.ipAddress,
      since,
    );

    if (attempts >= this.getRegisterMaxPerIp()) {
      throw new HttpException(
        AUTH_SECURITY_MESSAGES.TOO_MANY_ATTEMPTS,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordRegistrationAttempt(
    eventType:
      | typeof SecurityEventType.REGISTER_BUYER
      | typeof SecurityEventType.REGISTER_DEALER,
    email: string,
    session: SessionMetadata,
    options: {
      success: boolean;
      userId?: string | null;
      failureReason?: string | null;
    },
  ) {
    await this.securityEventsRepository.record({
      eventType,
      email,
      userId: options.userId ?? null,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
      success: options.success,
      failureReason: options.failureReason ?? null,
    });
  }

  async simulateRegistrationProcessing() {
    const jitterMs = 100 + Math.floor(Math.random() * 200);
    await this.sleep(jitterMs);
  }

  async assertRefreshAllowed(session: SessionMetadata) {
    const since = this.windowStart(this.getRefreshWindowMinutes());
    const attempts = await this.securityEventsRepository.countRecentByIp(
      SecurityEventType.REFRESH,
      session.ipAddress,
      since,
    );

    if (attempts >= this.getRefreshMaxPerIp()) {
      throw new HttpException(
        AUTH_SECURITY_MESSAGES.TOO_MANY_ATTEMPTS,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordRefreshFailure(
    session: SessionMetadata,
    failureReason: string,
  ): Promise<never> {
    await this.securityEventsRepository.record({
      eventType: SecurityEventType.REFRESH,
      email: null,
      userId: null,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
      success: false,
      failureReason,
    });
    throw new UnauthorizedException(AUTH_SECURITY_MESSAGES.INVALID_REFRESH_TOKEN);
  }

  async recordRefreshSuccess(
    userId: string,
    email: string,
    session: SessionMetadata,
  ) {
    await this.securityEventsRepository.record({
      eventType: SecurityEventType.REFRESH,
      email,
      userId,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
      success: true,
    });
  }

  async assertPasswordResetAllowed(email: string, session: SessionMetadata) {
    await this.assertIpRateLimit(SecurityEventType.PASSWORD_RESET, session.ipAddress);

    const since = this.windowStart(this.getPasswordResetWindowMinutes());
    const emailAttempts = await this.securityEventsRepository.countRecentByEmail(
      SecurityEventType.PASSWORD_RESET,
      email,
      since,
    );

    if (emailAttempts >= this.getPasswordResetMaxPerEmail()) {
      throw new HttpException(
        AUTH_SECURITY_MESSAGES.TOO_MANY_ATTEMPTS,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordPasswordResetRequest(
    email: string,
    session: SessionMetadata,
    userId?: string | null,
  ) {
    await this.simulateRegistrationProcessing();
    await this.securityEventsRepository.record({
      eventType: SecurityEventType.PASSWORD_RESET,
      email,
      userId: userId ?? null,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
      success: true,
    });

    return {
      message: AUTH_SECURITY_MESSAGES.PASSWORD_RESET_RECEIVED,
    };
  }

  async assertResendVerificationAllowed(email: string, session: SessionMetadata) {
    await this.assertIpRateLimit(
      SecurityEventType.RESEND_EMAIL_VERIFICATION,
      session.ipAddress,
    );

    const since = this.windowStart(this.getResendVerificationWindowMinutes());
    const emailAttempts = await this.securityEventsRepository.countRecentByEmail(
      SecurityEventType.RESEND_EMAIL_VERIFICATION,
      email,
      since,
    );

    if (emailAttempts >= this.getResendVerificationMaxPerEmail()) {
      throw new HttpException(
        AUTH_SECURITY_MESSAGES.TOO_MANY_ATTEMPTS,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordResendVerification(
    email: string,
    session: SessionMetadata,
    userId?: string | null,
  ) {
    await this.securityEventsRepository.record({
      eventType: SecurityEventType.RESEND_EMAIL_VERIFICATION,
      email,
      userId: userId ?? null,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
      success: true,
    });
  }

  private async assertIpRateLimit(
    eventType: SecurityEventType,
    ipAddress?: string | null,
  ) {
    const since = this.windowStart(this.getLoginWindowMinutes());
    const attempts = await this.securityEventsRepository.countRecentByIp(
      eventType,
      ipAddress,
      since,
    );

    if (attempts >= this.getIpMaxAttempts(eventType)) {
      throw new HttpException(
        AUTH_SECURITY_MESSAGES.TOO_MANY_ATTEMPTS,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async applyProgressiveDelay(attemptCount: number) {
    if (attemptCount <= 0) {
      return;
    }

    const baseDelay = this.configService.get<number>(
      'AUTH_PROGRESSIVE_DELAY_BASE_MS',
      250,
    );
    const maxDelay = this.configService.get<number>(
      'AUTH_PROGRESSIVE_DELAY_MAX_MS',
      4000,
    );
    const delay = Math.min(
      baseDelay * 2 ** Math.max(0, attemptCount - 1),
      maxDelay,
    );

    await this.sleep(delay);
  }

  private windowStart(windowMinutes: number) {
    return new Date(Date.now() - windowMinutes * 60_000);
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getLoginMaxAttempts() {
    return this.configService.get<number>('AUTH_LOGIN_MAX_ATTEMPTS', 5);
  }

  private getLoginLockoutMinutes() {
    return this.configService.get<number>('AUTH_LOGIN_LOCKOUT_MINUTES', 15);
  }

  private getLoginWindowMinutes() {
    return this.configService.get<number>('AUTH_LOGIN_WINDOW_MINUTES', 15);
  }

  private getRegisterMaxPerIp() {
    return this.configService.get<number>('AUTH_REGISTER_MAX_PER_IP', 5);
  }

  private getRegisterWindowMinutes() {
    return this.configService.get<number>('AUTH_REGISTER_WINDOW_MINUTES', 60);
  }

  private getRefreshMaxPerIp() {
    return this.configService.get<number>('AUTH_REFRESH_MAX_PER_IP', 30);
  }

  private getRefreshWindowMinutes() {
    return this.configService.get<number>('AUTH_REFRESH_WINDOW_MINUTES', 15);
  }

  private getPasswordResetMaxPerEmail() {
    return this.configService.get<number>('AUTH_PASSWORD_RESET_MAX_PER_EMAIL', 3);
  }

  private getPasswordResetWindowMinutes() {
    return this.configService.get<number>(
      'AUTH_PASSWORD_RESET_WINDOW_MINUTES',
      60,
    );
  }

  private getResendVerificationMaxPerEmail() {
    return this.configService.get<number>(
      'AUTH_RESEND_VERIFICATION_MAX_PER_EMAIL',
      3,
    );
  }

  private getResendVerificationWindowMinutes() {
    return this.configService.get<number>(
      'AUTH_RESEND_VERIFICATION_WINDOW_MINUTES',
      60,
    );
  }

  private getIpMaxAttempts(eventType: SecurityEventType) {
    const defaults: Record<SecurityEventType, number> = {
      [SecurityEventType.LOGIN]: 20,
      [SecurityEventType.ADMIN_LOGIN]: 20,
      [SecurityEventType.REGISTER_BUYER]: 5,
      [SecurityEventType.REGISTER_DEALER]: 5,
      [SecurityEventType.REFRESH]: 30,
      [SecurityEventType.PASSWORD_RESET]: 10,
      [SecurityEventType.RESEND_EMAIL_VERIFICATION]: 10,
    };

    return this.configService.get<number>(
      'AUTH_IP_MAX_ATTEMPTS',
      defaults[eventType],
    );
  }
}
