import { IsNull } from 'typeorm';
import { DealerProfile } from '../../src/infrastructure/database/entities/dealer-profile.entity';
import { EmailVerificationToken } from '../../src/infrastructure/database/entities/email-verification-token.entity';
import { PasswordHistory } from '../../src/infrastructure/database/entities/password-history.entity';
import { PasswordResetToken } from '../../src/infrastructure/database/entities/password-reset-token.entity';
import { RefreshToken } from '../../src/infrastructure/database/entities/refresh-token.entity';
import { User } from '../../src/infrastructure/database/entities/user.entity';
import type { SecurityEventType } from '../../src/modules/auth/constants/auth-security.constants';
import type { RecordSecurityEventInput } from '../../src/modules/auth/repositories/security-events.repository';
import { InMemoryAuthStore } from './in-memory-auth-store';

function isRefreshToken(candidate: unknown): candidate is RefreshToken {
  const record = candidate as RefreshToken;
  return Boolean(
    record?.userId && record?.familyId && record?.tokenHash && record?.expiresAt,
  );
}

function isUser(candidate: unknown): candidate is User {
  const record = candidate as User;
  return Boolean(record?.email && record?.passwordHash && record?.role);
}

function isDealerProfile(candidate: unknown): candidate is DealerProfile {
  const record = candidate as DealerProfile;
  return Boolean(record?.userId && record?.dealerType !== undefined);
}

export class InMemoryEntityManager {
  constructor(private readonly store: InMemoryAuthStore) {}

  findOne<T>(
    entityClass: new () => T,
    options: { where: Record<string, unknown> },
  ): Promise<T | null> {
    if (entityClass === (RefreshToken as unknown as new () => T)) {
      const id = options.where.id as string | undefined;
      if (id) {
        return Promise.resolve(
          (this.store.refreshTokens.get(id) as T | undefined) ?? null,
        );
      }
    }

    if (entityClass === (DealerProfile as unknown as new () => T)) {
      const userId = options.where.userId as string | undefined;
      if (userId) {
        return Promise.resolve(
          (this.store.dealerProfiles.get(userId) as T | undefined) ?? null,
        );
      }
    }

    return Promise.resolve(null);
  }

  create<T>(entityClass: new () => T, data: Partial<T>): T {
    if (entityClass === (RefreshToken as unknown as new () => T)) {
      return this.store.saveRefreshToken(
        data as Partial<RefreshToken> &
          Pick<RefreshToken, 'userId' | 'familyId' | 'tokenHash' | 'expiresAt'>,
      ) as unknown as T;
    }

    if (entityClass === (PasswordHistory as unknown as new () => T)) {
      const payload = data as Partial<PasswordHistory>;
      return this.store.savePasswordHistory(
        payload.userId!,
        payload.passwordHash!,
      ) as unknown as T;
    }

    if (entityClass === (User as unknown as new () => T)) {
      return { ...(data as object) } as T;
    }

    if (entityClass === (DealerProfile as unknown as new () => T)) {
      return { ...(data as object) } as T;
    }

    return { ...(data as object) } as T;
  }

  async save<T>(entity: T): Promise<T> {
    if (isRefreshToken(entity)) {
      return this.store.saveRefreshToken(entity) as unknown as T;
    }

    if (isUser(entity)) {
      return this.store.saveUser(entity) as unknown as T;
    }

    if (isDealerProfile(entity)) {
      return this.store.saveDealerProfile(entity) as unknown as T;
    }

    return entity;
  }

  async update(
    entityClass: new () => unknown,
    criteria: Record<string, unknown>,
    partial: Record<string, unknown>,
  ) {
    if (entityClass === RefreshToken) {
      const familyId = criteria.familyId as string | undefined;
      if (familyId && criteria.revokedAt === IsNull()) {
        const revokedAt = (partial.revokedAt as Date) ?? new Date();
        for (const token of this.store.refreshTokens.values()) {
          if (token.familyId === familyId && !token.revokedAt) {
            token.revokedAt = revokedAt;
          }
        }
        return { affected: 1 };
      }

      const id = criteria.id as string | undefined;
      if (id) {
        const token = this.store.refreshTokens.get(id);
        if (token) {
          Object.assign(token, partial);
        }
      }
      return { affected: 1 };
    }

    if (entityClass === User) {
      const id = criteria.id as string | undefined;
      if (id) {
        const user = this.store.users.get(id);
        if (user) {
          Object.assign(user, partial, { updatedAt: new Date() });
        }
      }
      return { affected: 1 };
    }

    if (entityClass === DealerProfile) {
      const userId = criteria.userId as string | undefined;
      if (userId) {
        const profile = this.store.dealerProfiles.get(userId);
        if (profile) {
          Object.assign(profile, partial, { updatedAt: new Date() });
        }
      }
      return { affected: 1 };
    }

    if (entityClass === EmailVerificationToken) {
      const id = criteria.id as string | undefined;
      if (id) {
        const token = this.store.emailVerificationTokens.get(id);
        if (token) {
          Object.assign(token, partial);
        }
      }
      return { affected: 1 };
    }

    if (entityClass === PasswordResetToken) {
      const id = criteria.id as string | undefined;
      if (id) {
        const token = this.store.passwordResetTokens.get(id);
        if (token) {
          Object.assign(token, partial);
        }
      }
      return { affected: 1 };
    }

    return Promise.resolve({ affected: 0 });
  }
}

export function createInMemoryDataSource(store: InMemoryAuthStore) {
  return {
    transaction<T>(fn: (manager: InMemoryEntityManager) => Promise<T>) {
      return fn(new InMemoryEntityManager(store));
    },
  };
}

export class InMemoryUsersRepository {
  constructor(private readonly store: InMemoryAuthStore) {}

  findById(id: string) {
    return Promise.resolve(this.store.users.get(id) ?? null);
  }

  findByEmail(email: string) {
    const id = this.store.usersByEmail.get(email.toLowerCase());
    return Promise.resolve(id ? this.store.users.get(id) ?? null : null);
  }

  findAll() {
    return Promise.resolve([...this.store.users.values()]);
  }

  create(data: Partial<User>) {
    return Promise.resolve(this.store.saveUser(data as never));
  }

  async update(id: string, data: Partial<User>) {
    const user = this.store.users.get(id);
    if (!user) {
      throw new Error(`User ${id} not found`);
    }
    Object.assign(user, data, { updatedAt: new Date() });
    return user;
  }

  async recordFailedLogin(
    userId: string,
    maxAttempts: number,
    lockoutMinutes: number,
  ) {
    const user = this.store.users.get(userId);
    if (!user) {
      return { failedLoginAttempts: 0, lockedUntil: null as Date | null };
    }

    const failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockedUntil =
      failedLoginAttempts >= maxAttempts
        ? new Date(Date.now() + lockoutMinutes * 60_000)
        : user.lockedUntil;

    user.failedLoginAttempts = failedLoginAttempts;
    user.lockedUntil = lockedUntil;
    user.updatedAt = new Date();

    return { failedLoginAttempts, lockedUntil };
  }

  clearLoginFailures(userId: string) {
    const user = this.store.users.get(userId);
    if (user) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.updatedAt = new Date();
    }
    return Promise.resolve({ affected: 1 });
  }
}

export class InMemoryDealerProfilesRepository {
  constructor(private readonly store: InMemoryAuthStore) {}

  findByUserId(userId: string) {
    return Promise.resolve(this.store.dealerProfiles.get(userId) ?? null);
  }

  findAll() {
    return Promise.resolve([...this.store.dealerProfiles.values()]);
  }

  create(data: Partial<DealerProfile>) {
    return Promise.resolve(this.store.saveDealerProfile(data as never));
  }

  update(userId: string, data: Partial<DealerProfile>) {
    const profile = this.store.dealerProfiles.get(userId);
    if (!profile) {
      throw new Error(`Dealer profile ${userId} not found`);
    }
    Object.assign(profile, data, { updatedAt: new Date() });
    return Promise.resolve(profile);
  }
}

export class InMemoryRefreshTokensRepository {
  constructor(private readonly store: InMemoryAuthStore) {}

  findByHash(tokenHash: string) {
    const id = this.store.refreshTokensByHash.get(tokenHash);
    return Promise.resolve(id ? this.store.refreshTokens.get(id) ?? null : null);
  }

  findActiveByHash(tokenHash: string) {
    return this.findByHash(tokenHash).then((token) => {
      if (!token || token.revokedAt) {
        return null;
      }
      return token;
    });
  }

  countActiveByUserId(userId: string) {
    const now = new Date();
    const count = [...this.store.refreshTokens.values()].filter(
      (token) =>
        token.userId === userId &&
        !token.revokedAt &&
        token.expiresAt > now,
    ).length;
    return Promise.resolve(count);
  }

  create(data: Partial<RefreshToken>) {
    return Promise.resolve(this.store.saveRefreshToken(data as never));
  }

  revoke(token: RefreshToken, revokedAt = new Date()) {
    token.revokedAt = revokedAt;
    return Promise.resolve(this.store.saveRefreshToken(token));
  }

  async revokeOldestActiveSessions(userId: string, count: number) {
    if (count <= 0) {
      return;
    }

    const now = new Date();
    const tokens = [...this.store.refreshTokens.values()]
      .filter(
        (token) =>
          token.userId === userId &&
          !token.revokedAt &&
          token.expiresAt > now,
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, count);

    const revokedAt = new Date();
    for (const token of tokens) {
      token.revokedAt = revokedAt;
    }
  }

  revokeAllActiveForUser(userId: string, revokedAt = new Date()) {
    for (const token of this.store.refreshTokens.values()) {
      if (token.userId === userId && !token.revokedAt) {
        token.revokedAt = revokedAt;
      }
    }
    return Promise.resolve({ affected: 1 });
  }

  revokeFamily(familyId: string, revokedAt = new Date()) {
    for (const token of this.store.refreshTokens.values()) {
      if (token.familyId === familyId && !token.revokedAt) {
        token.revokedAt = revokedAt;
      }
    }
    return Promise.resolve({ affected: 1 });
  }
}

export class InMemorySecurityEventsRepository {
  constructor(private readonly store: InMemoryAuthStore) {}

  record(input: RecordSecurityEventInput) {
    return Promise.resolve(this.store.recordSecurityEvent(input));
  }

  countRecentByIp(
    eventType: SecurityEventType,
    ipAddress: string | null | undefined,
    since: Date,
    success = false,
  ) {
    return Promise.resolve(
      this.store.countRecentByIp(eventType, ipAddress, since, success),
    );
  }

  countRecentByEmail(
    eventType: SecurityEventType,
    email: string,
    since: Date,
    success = false,
  ) {
    return Promise.resolve(
      this.store.countRecentByEmail(eventType, email, since, success),
    );
  }

  countRecentFailuresByEmail(
    eventTypes: SecurityEventType[],
    email: string,
    since: Date,
  ) {
    return Promise.resolve(
      this.store.countRecentFailuresByEmail(eventTypes, email, since),
    );
  }
}

export class InMemoryEmailVerificationTokensRepository {
  constructor(private readonly store: InMemoryAuthStore) {}

  findByHash(tokenHash: string) {
    const id = this.store.emailVerificationTokensByHash.get(tokenHash);
    return Promise.resolve(
      id ? this.store.emailVerificationTokens.get(id) ?? null : null,
    );
  }

  create(data: Partial<EmailVerificationToken>) {
    return Promise.resolve(this.store.saveEmailVerificationToken(data as never));
  }

  markUsed(token: EmailVerificationToken, usedAt = new Date()) {
    token.usedAt = usedAt;
    return Promise.resolve(this.store.saveEmailVerificationToken(token));
  }

  revokeUnusedForUser(userId: string, revokedAt = new Date()) {
    for (const token of this.store.emailVerificationTokens.values()) {
      if (token.userId === userId && !token.usedAt) {
        token.usedAt = revokedAt;
      }
    }
    return Promise.resolve({ affected: 1 });
  }
}

export class InMemoryPasswordResetTokensRepository {
  constructor(private readonly store: InMemoryAuthStore) {}

  findByHash(tokenHash: string) {
    const id = this.store.passwordResetTokensByHash.get(tokenHash);
    return Promise.resolve(
      id ? this.store.passwordResetTokens.get(id) ?? null : null,
    );
  }

  create(data: Partial<PasswordResetToken>) {
    return Promise.resolve(this.store.savePasswordResetToken(data as never));
  }

  markUsed(token: PasswordResetToken, usedAt = new Date()) {
    token.usedAt = usedAt;
    return Promise.resolve(this.store.savePasswordResetToken(token));
  }

  revokeUnusedForUser(userId: string, revokedAt = new Date()) {
    for (const token of this.store.passwordResetTokens.values()) {
      if (token.userId === userId && !token.usedAt) {
        token.usedAt = revokedAt;
      }
    }
    return Promise.resolve({ affected: 1 });
  }
}

export class InMemoryPasswordHistoryRepository {
  constructor(private readonly store: InMemoryAuthStore) {}

  findRecentForUser(userId: string, limit: number) {
    const entries = this.store.passwordHistory
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
    return Promise.resolve(entries);
  }

  create(userId: string, passwordHash: string) {
    return Promise.resolve(this.store.savePasswordHistory(userId, passwordHash));
  }

  async trimToLimit(userId: string, limit: number) {
    const entries = this.store.passwordHistory
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const stale = entries.slice(limit);
    for (const entry of stale) {
      const index = this.store.passwordHistory.indexOf(entry);
      if (index >= 0) {
        this.store.passwordHistory.splice(index, 1);
      }
    }
  }
}
