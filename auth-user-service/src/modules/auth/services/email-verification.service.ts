import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { EmailVerificationToken } from '../../../infrastructure/database/entities/email-verification-token.entity';
import { User } from '../../../infrastructure/database/entities/user.entity';
import { UsersRepository } from '../../users/repositories/users.repository';
import { AUTH_SECURITY_MESSAGES } from '../constants/auth-security.constants';
import { EmailVerificationTokensRepository } from '../repositories/email-verification-tokens.repository';
import { SessionMetadata } from '../types/session-metadata.type';
import { AuthAbuseProtectionService } from './auth-abuse-protection.service';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersRepository: UsersRepository,
    private readonly emailVerificationTokensRepository: EmailVerificationTokensRepository,
    private readonly authAbuseProtection: AuthAbuseProtectionService,
    private readonly dataSource: DataSource,
  ) {}

  async issueToken(user: User) {
    await this.emailVerificationTokensRepository.revokeUnusedForUser(user.id);

    const rawToken = randomBytes(32).toString('base64url');
    await this.emailVerificationTokensRepository.create({
      userId: user.id,
      tokenHash: this.hashToken(rawToken),
      expiresAt: new Date(Date.now() + this.getTokenTtlMs()),
    });

    this.logger.log(
      `Email verification token issued for user ${user.id} (${user.email})`,
    );

    return {
      rawToken,
      includeInResponse: this.shouldReturnTokenInResponse(),
    };
  }

  async verifyEmail(token: string) {
    const storedToken = await this.emailVerificationTokensRepository.findByHash(
      this.hashToken(token),
    );

    if (!storedToken || storedToken.usedAt || storedToken.expiresAt <= new Date()) {
      throw new BadRequestException(AUTH_SECURITY_MESSAGES.INVALID_VERIFICATION_TOKEN);
    }

    const user = await this.usersRepository.findById(storedToken.userId);
    if (!user) {
      throw new BadRequestException(AUTH_SECURITY_MESSAGES.INVALID_VERIFICATION_TOKEN);
    }

    if (user.emailVerifiedAt) {
      await this.emailVerificationTokensRepository.markUsed(storedToken);
      return {
        message: AUTH_SECURITY_MESSAGES.EMAIL_VERIFIED,
        emailVerified: true,
        role: user.role,
      };
    }

    const verifiedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        User,
        { id: user.id },
        {
          emailVerifiedAt: verifiedAt,
          isActive: user.role === 'BUYER',
        },
      );
      await manager.update(
        EmailVerificationToken,
        { id: storedToken.id },
        { usedAt: verifiedAt },
      );
    });

    return {
      message: AUTH_SECURITY_MESSAGES.EMAIL_VERIFIED,
      emailVerified: true,
      role: user.role,
      accountActivated: user.role === 'BUYER',
      dealerVerificationStatus:
        user.role === 'DEALER' ? 'PENDING' : undefined,
    };
  }

  async resendVerification(email: string, session: SessionMetadata) {
    await this.authAbuseProtection.assertResendVerificationAllowed(email, session);

    const user = await this.usersRepository.findByEmail(email);
    if (user && !user.emailVerifiedAt) {
      const issued = await this.issueToken(user);
      await this.authAbuseProtection.recordResendVerification(email, session, user.id);

      return {
        message: AUTH_SECURITY_MESSAGES.RESEND_VERIFICATION_RECEIVED,
        ...(issued.includeInResponse
          ? { verificationToken: issued.rawToken }
          : {}),
      };
    }

    await this.authAbuseProtection.recordResendVerification(
      email,
      session,
      user?.id ?? null,
    );
    await this.authAbuseProtection.simulateRegistrationProcessing();

    return {
      message: AUTH_SECURITY_MESSAGES.RESEND_VERIFICATION_RECEIVED,
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private getTokenTtlMs() {
    const hours = this.configService.get<number>(
      'EMAIL_VERIFICATION_EXPIRES_HOURS',
      24,
    );
    return hours * 3_600_000;
  }

  private shouldReturnTokenInResponse() {
    return this.configService.get<boolean>(
      'AUTH_RETURN_VERIFICATION_TOKEN',
      false,
    );
  }
}
