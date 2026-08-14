import { randomUUID } from 'node:crypto';
import {
  DealerProfile,
  DealerType,
  VerificationStatus,
} from '../../src/infrastructure/database/entities/dealer-profile.entity';
import { EmailVerificationToken } from '../../src/infrastructure/database/entities/email-verification-token.entity';
import { PasswordHistory } from '../../src/infrastructure/database/entities/password-history.entity';
import { PasswordResetToken } from '../../src/infrastructure/database/entities/password-reset-token.entity';
import { RefreshToken } from '../../src/infrastructure/database/entities/refresh-token.entity';
import { SecurityEvent } from '../../src/infrastructure/database/entities/security-event.entity';
import { User, UserRole } from '../../src/infrastructure/database/entities/user.entity';
import type { SecurityEventType } from '../../src/modules/auth/constants/auth-security.constants';
import type { RecordSecurityEventInput } from '../../src/modules/auth/repositories/security-events.repository';

export const IN_MEMORY_STORE = Symbol('IN_MEMORY_STORE');

export class InMemoryAuthStore {
  readonly users = new Map<string, User>();
  readonly usersByEmail = new Map<string, string>();
  readonly dealerProfiles = new Map<string, DealerProfile>();
  readonly refreshTokens = new Map<string, RefreshToken>();
  readonly refreshTokensByHash = new Map<string, string>();
  readonly emailVerificationTokens = new Map<string, EmailVerificationToken>();
  readonly emailVerificationTokensByHash = new Map<string, string>();
  readonly passwordResetTokens = new Map<string, PasswordResetToken>();
  readonly passwordResetTokensByHash = new Map<string, string>();
  readonly passwordHistory: PasswordHistory[] = [];
  readonly securityEvents: SecurityEvent[] = [];

  reset() {
    this.users.clear();
    this.usersByEmail.clear();
    this.dealerProfiles.clear();
    this.refreshTokens.clear();
    this.refreshTokensByHash.clear();
    this.emailVerificationTokens.clear();
    this.emailVerificationTokensByHash.clear();
    this.passwordResetTokens.clear();
    this.passwordResetTokensByHash.clear();
    this.passwordHistory.length = 0;
    this.securityEvents.length = 0;
  }

  saveUser(data: Partial<User> & Pick<User, 'email' | 'passwordHash' | 'name' | 'role'>) {
    const now = new Date();
    const user: User = {
      id: data.id ?? randomUUID(),
      email: data.email.toLowerCase(),
      passwordHash: data.passwordHash,
      name: data.name,
      role: data.role,
      isActive: data.isActive ?? false,
      emailVerifiedAt: data.emailVerifiedAt ?? null,
      failedLoginAttempts: data.failedLoginAttempts ?? 0,
      lockedUntil: data.lockedUntil ?? null,
      createdAt: data.createdAt ?? now,
      updatedAt: now,
    };

    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
    return user;
  }

  saveDealerProfile(data: Partial<DealerProfile> & Pick<DealerProfile, 'userId'>) {
    const now = new Date();
    const profile: DealerProfile = {
      userId: data.userId,
      dealerType: data.dealerType ?? DealerType.INDIVIDUAL,
      businessRegistrationNumber: data.businessRegistrationNumber ?? '',
      businessAddress: data.businessAddress ?? '',
      city: data.city ?? '',
      verificationDocuments: data.verificationDocuments ?? {},
      companyName: data.companyName ?? '',
      contactNumber: data.contactNumber ?? null,
      verificationStatus:
        data.verificationStatus ?? VerificationStatus.PENDING,
      verifiedBy: data.verifiedBy ?? null,
      verifiedAt: data.verifiedAt ?? null,
      createdAt: data.createdAt ?? now,
      updatedAt: now,
    };

    this.dealerProfiles.set(profile.userId, profile);
    return profile;
  }

  saveRefreshToken(data: Partial<RefreshToken> & Pick<RefreshToken, 'userId' | 'familyId' | 'tokenHash' | 'expiresAt'>) {
    const token: RefreshToken = {
      id: data.id ?? randomUUID(),
      userId: data.userId,
      familyId: data.familyId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      revokedAt: data.revokedAt ?? null,
      replacedById: data.replacedById ?? null,
      userAgent: data.userAgent ?? null,
      ipAddress: data.ipAddress ?? null,
      deviceLabel: data.deviceLabel ?? null,
      lastUsedAt: data.lastUsedAt ?? null,
      createdAt: data.createdAt ?? new Date(),
    };

    this.refreshTokens.set(token.id, token);
    this.refreshTokensByHash.set(token.tokenHash, token.id);
    return token;
  }

  saveEmailVerificationToken(
    data: Partial<EmailVerificationToken> &
      Pick<EmailVerificationToken, 'userId' | 'tokenHash' | 'expiresAt'>,
  ) {
    const token: EmailVerificationToken = {
      id: data.id ?? randomUUID(),
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      usedAt: data.usedAt ?? null,
      createdAt: data.createdAt ?? new Date(),
    };

    this.emailVerificationTokens.set(token.id, token);
    this.emailVerificationTokensByHash.set(token.tokenHash, token.id);
    return token;
  }

  savePasswordResetToken(
    data: Partial<PasswordResetToken> &
      Pick<PasswordResetToken, 'userId' | 'tokenHash' | 'expiresAt'>,
  ) {
    const token: PasswordResetToken = {
      id: data.id ?? randomUUID(),
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      usedAt: data.usedAt ?? null,
      createdAt: data.createdAt ?? new Date(),
    };

    this.passwordResetTokens.set(token.id, token);
    this.passwordResetTokensByHash.set(token.tokenHash, token.id);
    return token;
  }

  savePasswordHistory(userId: string, passwordHash: string) {
    const entry: PasswordHistory = {
      id: randomUUID(),
      userId,
      passwordHash,
      createdAt: new Date(),
    };
    this.passwordHistory.push(entry);
    return entry;
  }

  recordSecurityEvent(input: RecordSecurityEventInput) {
    const event: SecurityEvent = {
      id: randomUUID(),
      eventType: input.eventType,
      email: input.email ?? null,
      userId: input.userId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      success: input.success,
      failureReason: input.failureReason ?? null,
      createdAt: new Date(),
    };
    this.securityEvents.push(event);
    return event;
  }

  countSecurityEvents(predicate: (event: SecurityEvent) => boolean) {
    return this.securityEvents.filter(predicate).length;
  }

  countRecentByIp(
    eventType: SecurityEventType,
    ipAddress: string | null | undefined,
    since: Date,
    success = false,
  ) {
    if (!ipAddress) {
      return 0;
    }

    return this.countSecurityEvents(
      (event) =>
        event.eventType === eventType &&
        event.ipAddress === ipAddress &&
        event.success === success &&
        event.createdAt > since,
    );
  }

  countRecentByEmail(
    eventType: SecurityEventType,
    email: string,
    since: Date,
    success = false,
  ) {
    return this.countSecurityEvents(
      (event) =>
        event.eventType === eventType &&
        event.email === email &&
        event.success === success &&
        event.createdAt > since,
    );
  }

  countRecentFailuresByEmail(
    eventTypes: SecurityEventType[],
    email: string,
    since: Date,
  ) {
    return this.countSecurityEvents(
      (event) =>
        event.email === email &&
        !event.success &&
        event.createdAt > since &&
        eventTypes.includes(event.eventType as SecurityEventType),
    );
  }
}

export type SeedUserOptions = {
  email: string;
  passwordHash: string;
  name: string;
  role?: UserRole;
  isActive?: boolean;
  emailVerifiedAt?: Date | null;
};
