import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import {
  DealerProfile,
  VerificationStatus,
} from '../../../infrastructure/database/entities/dealer-profile.entity';
import { User } from '../../../infrastructure/database/entities/user.entity';
import { DealerProfilesRepository } from '../../dealers/repositories/dealer-profiles.repository';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { RegisterBuyerDto } from '../dto/register-buyer.dto';
import { RegisterDealerDto } from '../dto/register-dealer.dto';
import { RefreshTokensRepository } from '../repositories/refresh-tokens.repository';
import { UsersRepository } from '../../users/repositories/users.repository';
import {
  AccessTokenPayload,
  getAccessTokenSignOptions,
} from '../config/jwt.config';

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

  async registerBuyer(data: RegisterBuyerDto) {
    const email = data.email.trim().toLowerCase();
    await this.ensureEmailIsAvailable(email);
    const user = await this.usersRepository.create({
      email,
      passwordHash: await bcrypt.hash(data.password, 12),
      name: data.name,
      role: 'BUYER',
    });

    return this.issueTokenPair(user);
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

    // FR-02 / SAD §4.1.1: pending until admin approval — no JWT at registration (FR-03).
    return {
      message:
        'Registration submitted. Your account is pending administrator approval.',
      user: this.toSafeUser(user),
      verificationStatus: VerificationStatus.PENDING,
    };
  }
  // The login method authenticates a user based on their email and password. It checks if the user exists, verifies the password, and ensures the account is active. If successful, it issues a new token pair (access and refresh tokens).
  async login(data: LoginDto) {
    const user = await this.authenticate(data);
    if (user.role === 'ADMIN') {
      throw new UnauthorizedException(
        'Admin accounts must use the admin login endpoint',
      );
    }

    return this.issueTokenPair(user);
  }

  async loginAdmin(data: LoginDto) {
    const user = await this.authenticate(data);
    if (user.role !== 'ADMIN') {
      throw new UnauthorizedException('Admin credentials required');
    }

    return this.issueTokenPair(user);
  }
// The refresh method allows a user to obtain a new access token using a valid refresh token. It checks if the refresh token is valid and not expired, revokes the old token, and issues a new token pair.
  async refresh(data: RefreshTokenDto) {
    const tokenHash = this.hashRefreshToken(data.refreshToken);
    const storedToken = await this.refreshTokensRepository.findActiveByHash(
      tokenHash,
    );

    if (!storedToken || storedToken.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.refreshTokensRepository.revoke(storedToken);
    const user = await this.usersRepository.findById(storedToken.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Unable to refresh this session');
    }

    return this.issueTokenPair(user);
  }

// The logout method allows a user to log out by revoking their refresh token. It checks if the provided refresh token is valid and active, and if so, revokes it to prevent further use.
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

  private async ensureEmailIsAvailable(email: string) {
    const existingUser = await this.usersRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }
  }

  private async issueTokenPair(user: User) {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(
      payload,
      getAccessTokenSignOptions(this.configService),
    );

    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresIn = this.parseDuration(
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    );
    await this.refreshTokensRepository.create({
      userId: user.id,
      tokenHash: this.hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + refreshExpiresIn),
    });

    return {
      accessToken,
      refreshToken,
      user: this.toSafeUser(user),
    };
  }
// The hashRefreshToken method generates a SHA-256 hash of the provided refresh token. This is used to securely store and compare refresh tokens in the database without exposing the actual token value.
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
