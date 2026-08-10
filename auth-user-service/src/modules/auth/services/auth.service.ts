import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import {
  DealerProfile,
  VerificationStatus,
} from '../../../infrastructure/database/entities/dealer-profile.entity';
import { RefreshToken } from '../../../infrastructure/database/entities/refresh-token.entity';
import { User } from '../../../infrastructure/database/entities/user.entity';
import { DealerProfilesRepository } from '../../dealers/repositories/dealer-profiles.repository';
import { UsersRepository } from '../../users/repositories/users.repository';
import {
  AccessTokenPayload,
  getAccessTokenSignOptions,
} from '../config/jwt.config';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { RegisterBuyerDto } from '../dto/register-buyer.dto';
import { RegisterDealerDto } from '../dto/register-dealer.dto';
import { RefreshTokensRepository } from '../repositories/refresh-tokens.repository';
import { SessionMetadata } from '../types/session-metadata.type';

type AuthUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'isActive'>;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly dealerProfilesRepository: DealerProfilesRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async registerBuyer(
    data: RegisterBuyerDto,
    session: SessionMetadata = {},
  ) {
    const email = data.email.trim().toLowerCase();
    await this.ensureEmailIsAvailable(email);
    const user = await this.usersRepository.create({
      email,
      passwordHash: await bcrypt.hash(data.password, 12),
      name: data.name,
      role: 'BUYER',
    });

    return this.issueTokenPair(user, {
      ...session,
      deviceLabel: data.deviceLabel ?? session.deviceLabel ?? null,
    });
  }

  async registerDealer(data: RegisterDealerDto) {
    const email = data.email.trim().toLowerCase();
    await this.ensureEmailIsAvailable(email);
    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await this.dataSource.transaction(async (manager) => {
      const createdUser = await manager.save(
        manager.create(User, {
          email,
          passwordHash,
          name: data.name,
          role: 'DEALER',
          isActive: false,
        }),
      );

      await manager.save(
        manager.create(DealerProfile, {
          userId: createdUser.id,
          dealerType: data.dealerType,
          businessRegistrationNumber: data.businessRegistrationNumber ?? '',
          businessAddress: data.businessAddress,
          city: data.city,
          verificationDocuments: data.verificationDocuments,
          companyName: data.companyName,
          contactNumber: data.contactNumber ?? null,
        }),
      );

      return createdUser;
    });

    return {
      message:
        'Registration submitted. Your account is pending administrator approval.',
      user: this.toSafeUser(user),
      verificationStatus: VerificationStatus.PENDING,
    };
  }

  async login(data: LoginDto, session: SessionMetadata = {}) {
    const user = await this.authenticate(data);
    if (user.role === 'ADMIN') {
      throw new UnauthorizedException(
        'Admin accounts must use the admin login endpoint',
      );
    }

    return this.issueTokenPair(user, {
      ...session,
      deviceLabel: data.deviceLabel ?? session.deviceLabel ?? null,
    });
  }

  async loginAdmin(data: LoginDto, session: SessionMetadata = {}) {
    const user = await this.authenticate(data);
    if (user.role !== 'ADMIN') {
      throw new UnauthorizedException('Admin credentials required');
    }

    return this.issueTokenPair(user, {
      ...session,
      deviceLabel: data.deviceLabel ?? session.deviceLabel ?? null,
    });
  }

  async refresh(data: RefreshTokenDto, session: SessionMetadata = {}) {
    const tokenHash = this.hashRefreshToken(data.refreshToken);
    const storedToken = await this.refreshTokensRepository.findByHash(tokenHash);

    if (!storedToken) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (storedToken.revokedAt) {
      await this.refreshTokensRepository.revokeFamily(storedToken.familyId);
      throw new UnauthorizedException(
        'Refresh token reuse detected. All sessions in this family have been revoked',
      );
    }

    if (storedToken.expiresAt <= new Date()) {
      await this.refreshTokensRepository.revoke(storedToken);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersRepository.findById(storedToken.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Unable to refresh this session');
    }

    return this.rotateTokenPair(user, storedToken, {
      ...session,
      deviceLabel: data.deviceLabel ?? session.deviceLabel ?? null,
    });
  }

  async logout(data: RefreshTokenDto) {
    const tokenHash = this.hashRefreshToken(data.refreshToken);
    const storedToken = await this.refreshTokensRepository.findActiveByHash(
      tokenHash,
    );
    if (storedToken) {
      await this.refreshTokensRepository.revoke(storedToken);
    }
    return { success: true };
  }

  async logoutAllSessions(userId: string) {
    await this.refreshTokensRepository.revokeAllActiveForUser(userId);
    return { success: true };
  }

  private async ensureEmailIsAvailable(email: string) {
    const existingUser = await this.usersRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }
  }

  private async issueTokenPair(user: User, session: SessionMetadata = {}) {
    await this.enforceSessionLimit(user.id);

    const accessToken = await this.signAccessToken(user);
    const refreshToken = randomBytes(32).toString('base64url');
    const now = new Date();

    await this.refreshTokensRepository.create({
      userId: user.id,
      familyId: randomUUID(),
      tokenHash: this.hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + this.getRefreshTokenTtlMs()),
      userAgent: session.userAgent ?? null,
      ipAddress: session.ipAddress ?? null,
      deviceLabel: session.deviceLabel ?? null,
      lastUsedAt: now,
    });

    return {
      accessToken,
      refreshToken,
      user: this.toSafeUser(user),
    };
  }

  private async rotateTokenPair(
    user: User,
    storedToken: RefreshToken,
    session: SessionMetadata,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(RefreshToken, {
        where: { id: storedToken.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!locked) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      if (locked.revokedAt) {
        await this.revokeFamilyInTransaction(manager, locked.familyId);
        throw new UnauthorizedException(
          'Refresh token reuse detected. All sessions in this family have been revoked',
        );
      }

      if (locked.expiresAt <= new Date()) {
        locked.revokedAt = new Date();
        await manager.save(locked);
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      const refreshToken = randomBytes(32).toString('base64url');
      const now = new Date();
      const newToken = manager.create(RefreshToken, {
        userId: user.id,
        familyId: locked.familyId,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + this.getRefreshTokenTtlMs()),
        userAgent: session.userAgent ?? locked.userAgent,
        ipAddress: session.ipAddress ?? locked.ipAddress,
        deviceLabel: session.deviceLabel ?? locked.deviceLabel,
        lastUsedAt: now,
      });
      const saved = await manager.save(newToken);

      locked.revokedAt = now;
      locked.replacedById = saved.id;
      locked.lastUsedAt = now;
      await manager.save(locked);

      return {
        accessToken: await this.signAccessToken(user),
        refreshToken,
        user: this.toSafeUser(user),
      };
    });
  }

  private async revokeFamilyInTransaction(
    manager: EntityManager,
    familyId: string,
    revokedAt = new Date(),
  ) {
    await manager.update(
      RefreshToken,
      { familyId, revokedAt: IsNull() },
      { revokedAt },
    );
  }

  private async enforceSessionLimit(userId: string) {
    const maxSessions = this.configService.get<number>(
      'MAX_ACTIVE_REFRESH_SESSIONS',
      5,
    );
    const activeCount =
      await this.refreshTokensRepository.countActiveByUserId(userId);

    if (activeCount >= maxSessions) {
      await this.refreshTokensRepository.revokeOldestActiveSessions(
        userId,
        activeCount - maxSessions + 1,
      );
    }
  }

  private signAccessToken(user: User) {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return this.jwtService.signAsync(
      payload,
      getAccessTokenSignOptions(this.configService),
    );
  }

  private getRefreshTokenTtlMs() {
    return this.parseDuration(
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    );
  }

  private async authenticate(data: LoginDto) {
    const user = await this.usersRepository.findByEmail(
      data.email.trim().toLowerCase(),
    );
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) {
      await this.throwInactiveAccountError(user);
    }
    return user;
  }

  private async throwInactiveAccountError(user: User): Promise<never> {
    if (user.role === 'DEALER') {
      const profile = await this.dealerProfilesRepository.findByUserId(user.id);

      if (profile?.verificationStatus === VerificationStatus.PENDING) {
        throw new UnauthorizedException(
          'Your dealer account is pending administrator approval',
        );
      }

      if (profile?.verificationStatus === VerificationStatus.REJECTED) {
        throw new UnauthorizedException(
          'Your dealer registration was rejected. Contact support to resubmit',
        );
      }
    }

    throw new UnauthorizedException('This account is inactive');
  }

  private hashRefreshToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseDuration(value: string) {
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) {
      throw new Error('Invalid token duration configuration');
    }

    const amount = Number(match[1]);
    const multipliers = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return amount * multipliers[match[2] as keyof typeof multipliers];
  }

  private toSafeUser(user: User): AuthUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
    };
  }
}
