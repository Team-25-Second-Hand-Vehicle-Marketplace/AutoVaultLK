import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { EmailVerificationTokensRepository } from '../../src/modules/auth/repositories/email-verification-tokens.repository';
import { PasswordHistoryRepository } from '../../src/modules/auth/repositories/password-history.repository';
import { PasswordResetTokensRepository } from '../../src/modules/auth/repositories/password-reset-tokens.repository';
import { SecurityEventsRepository } from '../../src/modules/auth/repositories/security-events.repository';
import { SecurityEventType } from '../../src/modules/auth/constants/auth-security.constants';
import { EmailVerificationToken } from '../../src/infrastructure/database/entities/email-verification-token.entity';
import { PasswordHistory } from '../../src/infrastructure/database/entities/password-history.entity';
import { PasswordResetToken } from '../../src/infrastructure/database/entities/password-reset-token.entity';
import { SecurityEvent } from '../../src/infrastructure/database/entities/security-event.entity';
import {
  connect,
  createFixtureUser,
  describeWithDatabase,
  disconnect,
  fixtureEmail,
  repositoryFor,
} from './test-database';

describeWithDatabase('Token and security-event repositories (integration)', () => {
  let ds: DataSource;
  let emailTokens: EmailVerificationTokensRepository;
  let resetTokens: PasswordResetTokensRepository;
  let passwordHistory: PasswordHistoryRepository;
  let securityEvents: SecurityEventsRepository;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const connection = await connect();
    if (!connection)
      throw new Error('Database became unreachable after the probe');
    ds = connection;
    emailTokens = new EmailVerificationTokensRepository(
      repositoryFor(ds, EmailVerificationToken),
    );
    resetTokens = new PasswordResetTokensRepository(repositoryFor(ds, PasswordResetToken));
    passwordHistory = new PasswordHistoryRepository(repositoryFor(ds, PasswordHistory));
    securityEvents = new SecurityEventsRepository(repositoryFor(ds, SecurityEvent));
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await ds.query(`DELETE FROM auth.users WHERE id = ANY($1)`, [createdUserIds]);
    }
    await disconnect();
  });

  const fixtureUser = async () => {
    const user = await createFixtureUser(ds);
    createdUserIds.push(user.id);
    return user;
  };

  describe('EmailVerificationTokensRepository', () => {
    it('rejects a duplicate token_hash', async () => {
      const user = await fixtureUser();
      const hash = `dup-${randomUUID()}`;
      await emailTokens.create({
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      await expect(
        emailTokens.create({
          userId: user.id,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
      ).rejects.toThrow();
    });

    it('markUsed sets usedAt and persists it', async () => {
      const user = await fixtureUser();
      const token = await emailTokens.create({
        userId: user.id,
        tokenHash: `hash-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      await emailTokens.markUsed(token);

      const reloaded = await emailTokens.findByHash(token.tokenHash);
      expect(reloaded!.usedAt).not.toBeNull();
    });

    it('revokeUnusedForUser marks only unused tokens for that user, not another user\'s', async () => {
      const user = await fixtureUser();
      const otherUser = await fixtureUser();
      const unused = await emailTokens.create({
        userId: user.id,
        tokenHash: `hash-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const alreadyUsed = await emailTokens.create({
        userId: user.id,
        tokenHash: `hash-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await emailTokens.markUsed(alreadyUsed);
      const otherUsersToken = await emailTokens.create({
        userId: otherUser.id,
        tokenHash: `hash-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      const beforeUsedAt = (await emailTokens.findByHash(alreadyUsed.tokenHash))!.usedAt;
      await emailTokens.revokeUnusedForUser(user.id);

      const [reloadedUnused, reloadedAlreadyUsed, reloadedOther] = await Promise.all([
        emailTokens.findByHash(unused.tokenHash),
        emailTokens.findByHash(alreadyUsed.tokenHash),
        emailTokens.findByHash(otherUsersToken.tokenHash),
      ]);
      expect(reloadedUnused!.usedAt).not.toBeNull();
      // Already-used row's usedAt is untouched by the bulk revoke.
      expect(reloadedAlreadyUsed!.usedAt!.getTime()).toBe(beforeUsedAt!.getTime());
      expect(reloadedOther!.usedAt).toBeNull();
    });
  });

  describe('PasswordResetTokensRepository', () => {
    it('rejects a duplicate token_hash', async () => {
      const user = await fixtureUser();
      const hash = `dup-${randomUUID()}`;
      await resetTokens.create({
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      await expect(
        resetTokens.create({
          userId: user.id,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
      ).rejects.toThrow();
    });

    it('revokeUnusedForUser leaves other users\' tokens untouched', async () => {
      const user = await fixtureUser();
      const otherUser = await fixtureUser();
      const mine = await resetTokens.create({
        userId: user.id,
        tokenHash: `hash-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const theirs = await resetTokens.create({
        userId: otherUser.id,
        tokenHash: `hash-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      });

      await resetTokens.revokeUnusedForUser(user.id);

      const [reloadedMine, reloadedTheirs] = await Promise.all([
        resetTokens.findByHash(mine.tokenHash),
        resetTokens.findByHash(theirs.tokenHash),
      ]);
      expect(reloadedMine!.usedAt).not.toBeNull();
      expect(reloadedTheirs!.usedAt).toBeNull();
    });
  });

  describe('PasswordHistoryRepository', () => {
    it('findRecentForUser returns entries newest first, capped at limit', async () => {
      const user = await fixtureUser();
      for (let i = 0; i < 4; i++) {
        await passwordHistory.create(user.id, `hash-${i}-${randomUUID()}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const recent = await passwordHistory.findRecentForUser(user.id, 2);

      expect(recent).toHaveLength(2);
      expect(recent[0].createdAt.getTime()).toBeGreaterThanOrEqual(
        recent[1].createdAt.getTime(),
      );
    });

    it('trimToLimit removes only entries beyond the limit, oldest first', async () => {
      const user = await fixtureUser();
      const hashes: string[] = [];
      for (let i = 0; i < 5; i++) {
        const entry = await passwordHistory.create(user.id, `hash-${i}-${randomUUID()}`);
        hashes.push(entry.passwordHash);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      await passwordHistory.trimToLimit(user.id, 3);

      const remaining = await passwordHistory.findRecentForUser(user.id, 10);
      expect(remaining).toHaveLength(3);
      // The 3 most recently created hashes (last 3 pushed) survive.
      const survivingHashes = remaining.map((r) => r.passwordHash);
      expect(survivingHashes).toEqual(expect.arrayContaining(hashes.slice(-3)));
    });
  });

  describe('SecurityEventsRepository', () => {
    it('countRecentByIp counts only matching event type/ip/success within the window', async () => {
      const ip = `10.0.0.${Math.floor(Math.random() * 250) + 1}`;
      const since = new Date(Date.now() - 60_000);

      await securityEvents.record({
        eventType: SecurityEventType.LOGIN,
        ipAddress: ip,
        success: false,
      });
      await securityEvents.record({
        eventType: SecurityEventType.LOGIN,
        ipAddress: ip,
        success: true, // different success value, must not count
      });
      await securityEvents.record({
        eventType: SecurityEventType.LOGIN,
        ipAddress: '203.0.113.9', // different ip, must not count
        success: false,
      });

      const count = await securityEvents.countRecentByIp(
        SecurityEventType.LOGIN,
        ip,
        since,
        false,
      );

      expect(count).toBe(1);
    });

    it('countRecentByIp returns 0 without querying when ipAddress is falsy', async () => {
      const count = await securityEvents.countRecentByIp(
        SecurityEventType.LOGIN,
        null,
        new Date(),
        false,
      );
      expect(count).toBe(0);
    });

    it('countRecentByEmail respects the since boundary', async () => {
      const email = fixtureEmail('sec-event');

      await securityEvents.record({
        eventType: SecurityEventType.LOGIN,
        email,
        success: false,
      });

      const countWithinWindow = await securityEvents.countRecentByEmail(
        SecurityEventType.LOGIN,
        email,
        new Date(Date.now() - 60_000),
        false,
      );
      const countOutsideWindow = await securityEvents.countRecentByEmail(
        SecurityEventType.LOGIN,
        email,
        new Date(Date.now() + 60_000),
        false,
      );

      expect(countWithinWindow).toBe(1);
      expect(countOutsideWindow).toBe(0);
    });

    it('countRecentFailuresByEmail combines multiple event types with an IN clause', async () => {
      const email = fixtureEmail('multi-event');
      const since = new Date(Date.now() - 60_000);

      await securityEvents.record({
        eventType: SecurityEventType.LOGIN,
        email,
        success: false,
      });
      await securityEvents.record({
        eventType: SecurityEventType.PASSWORD_RESET,
        email,
        success: false,
      });
      await securityEvents.record({
        eventType: SecurityEventType.LOGIN,
        email,
        success: true, // success=true must be excluded
      });

      const count = await securityEvents.countRecentFailuresByEmail(
        [SecurityEventType.LOGIN, SecurityEventType.PASSWORD_RESET],
        email,
        since,
      );

      expect(count).toBe(2);
    });

    it('security_events.user_id SETs NULL rather than cascading when the user is deleted', async () => {
      const user = await createFixtureUser(ds);
      const saved = await securityEvents.record({
        eventType: SecurityEventType.LOGIN,
        userId: user.id,
        success: true,
      });

      await ds.query(`DELETE FROM auth.users WHERE id = $1`, [user.id]);

      // The event row itself must still exist - SET NULL, not a cascading
      // delete of the audit trail - but its user_id is now null rather than
      // pointing at a deleted row.
      const [row] = await ds.query<{ id: string; user_id: string | null }[]>(
        `SELECT id, user_id FROM auth.security_events WHERE id = $1`,
        [saved.id],
      );
      expect(row).toBeDefined();
      expect(row.user_id).toBeNull();
    });
  });
});
