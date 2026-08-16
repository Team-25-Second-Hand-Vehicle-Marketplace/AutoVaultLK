import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PasswordHistory } from '../../../infrastructure/database/entities/password-history.entity';
import { PasswordResetToken } from '../../../infrastructure/database/entities/password-reset-token.entity';
import { User } from '../../../infrastructure/database/entities/user.entity';
import { UsersRepository } from '../../users/repositories/users.repository';
import { AUTH_SECURITY_MESSAGES } from '../constants/auth-security.constants';
import { PasswordHistoryRepository } from '../repositories/password-history.repository';
import { PasswordResetTokensRepository } from '../repositories/password-reset-tokens.repository';
import { RefreshTokensRepository } from '../repositories/refresh-tokens.repository';

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersRepository: UsersRepository,
    private readonly passwordResetTokensRepository: PasswordResetTokensRepository,
    private readonly passwordHistoryRepository: PasswordHistoryRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly dataSource: DataSource,
  ) {}

  async issueResetToken(user: User) {
    await this.passwordResetTokensRepository.revokeUnusedForUser(user.id);

    const rawToken = randomBytes(32).toString('base64url');
    await this.passwordResetTokensRepository.create({
      userId: user.id,
      tokenHash: this.hashToken(rawToken),
      expiresAt: new Date(Date.now() + this.getResetTokenTtlMs()),
    });

    const includeInResponse = this.shouldReturnTokenInResponse();
    if (includeInResponse) {
      this.logger.log(
        `DEV password reset token for ${user.email}: ${rawToken}`,
      );
    } else {
      this.logger.log(
        `Password reset token issued for user ${user.id} (${user.email})`,
      );
    }

    return {
      rawToken,
      includeInResponse,
    };
  }

  async requestResetResponse(user: User | null) {
    if (!user) {
      return { message: AUTH_SECURITY_MESSAGES.PASSWORD_RESET_RECEIVED };
    }

    const issued = await this.issueResetToken(user);
    return {
      message: AUTH_SECURITY_MESSAGES.PASSWORD_RESET_RECEIVED,
      ...(issued.includeInResponse ? { resetToken: issued.rawToken } : {}),
    };
  }

  async confirmReset(token: string, newPassword: string) {
    const storedToken = await this.passwordResetTokensRepository.findByHash(
      this.hashToken(token),
    );

    if (!storedToken || storedToken.usedAt || storedToken.expiresAt <= new Date()) {
      throw new BadRequestException(AUTH_SECURITY_MESSAGES.INVALID_RESET_TOKEN);
    }

    const user = await this.usersRepository.findById(storedToken.userId);
    if (!user) {
      throw new BadRequestException(AUTH_SECURITY_MESSAGES.INVALID_RESET_TOKEN);
    }

    await this.assertPasswordNotReused(user, newPassword);
    await this.updatePassword(user, newPassword, storedToken);

    return { message: AUTH_SECURITY_MESSAGES.PASSWORD_RESET_COMPLETE };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User account is inactive or not found');
    }

    const currentMatches = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!currentMatches) {
      throw new UnauthorizedException(
        AUTH_SECURITY_MESSAGES.CURRENT_PASSWORD_INCORRECT,
      );
    }

    await this.assertPasswordNotReused(user, newPassword);
    await this.updatePassword(user, newPassword);

    return { message: AUTH_SECURITY_MESSAGES.PASSWORD_CHANGED };
  }

  private async updatePassword(
    user: User,
    newPassword: string,
    resetToken?: PasswordResetToken,
  ) {
    const newHash = await bcrypt.hash(newPassword, 12);
    const historyLimit = this.getPasswordHistoryCount();

    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        manager.create(PasswordHistory, {
          userId: user.id,
          passwordHash: user.passwordHash,
        }),
      );
      await manager.update(User, { id: user.id }, { passwordHash: newHash });

      if (resetToken) {
        await manager.update(
          PasswordResetToken,
          { id: resetToken.id },
          { usedAt: new Date() },
        );
      }
    });

    await this.passwordHistoryRepository.trimToLimit(user.id, historyLimit);
    await this.refreshTokensRepository.revokeAllActiveForUser(user.id);
    await this.usersRepository.clearLoginFailures(user.id);
  }

  private async assertPasswordNotReused(user: User, newPassword: string) {
    const historyLimit = this.getPasswordHistoryCount();
    const recentHistory = await this.passwordHistoryRepository.findRecentForUser(
      user.id,
      historyLimit,
    );

    const candidateHashes = [
      user.passwordHash,
      ...recentHistory.map((entry) => entry.passwordHash),
    ];

    for (const hash of candidateHashes) {
      if (await bcrypt.compare(newPassword, hash)) {
        throw new BadRequestException(AUTH_SECURITY_MESSAGES.PASSWORD_REUSED);
      }
    }
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private getResetTokenTtlMs() {
    const minutes = this.configService.get<number>(
      'PASSWORD_RESET_EXPIRES_MINUTES',
      60,
    );
    return minutes * 60_000;
  }

  private getPasswordHistoryCount() {
    return this.configService.get<number>('PASSWORD_HISTORY_COUNT', 5);
  }

  private shouldReturnTokenInResponse() {
    return this.configService.get<boolean>(
      'AUTH_RETURN_PASSWORD_RESET_TOKEN',
      false,
    );
  }
}
