import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { RefreshTokensRepository } from '../../src/modules/auth/repositories/refresh-tokens.repository';
import { RefreshToken } from '../../src/infrastructure/database/entities/refresh-token.entity';
import { User } from '../../src/infrastructure/database/entities/user.entity';
import {
  connect,
  createFixtureUser,
  deleteFixtureUser,
  describeWithDatabase,
  disconnect,
  repositoryFor,
} from './test-database';

describeWithDatabase('RefreshTokensRepository (integration)', () => {
  let ds: DataSource;
  let repository: RefreshTokensRepository;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const connection = await connect();
    if (!connection)
      throw new Error('Database became unreachable after the probe');
    ds = connection;
    repository = new RefreshTokensRepository(repositoryFor(ds, RefreshToken));
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      // Cascades to any refresh_tokens rows still attached.
      await ds.query(`DELETE FROM auth.users WHERE id = ANY($1)`, [createdUserIds]);
    }
    await disconnect();
  });

  const fixtureUser = async () => {
    const user = await createFixtureUser(ds);
    createdUserIds.push(user.id);
    return user;
  };

  const create = (userId: string, overrides: Partial<RefreshToken> = {}) =>
    repository.create({
      userId,
      familyId: randomUUID(),
      tokenHash: `hash-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 3_600_000),
      ...overrides,
    });

  describe('token_hash uniqueness', () => {
    it('rejects two tokens with the same hash', async () => {
      const user = await fixtureUser();
      const hash = `dup-${randomUUID()}`;
      await create(user.id, { tokenHash: hash });

      await expect(create(user.id, { tokenHash: hash })).rejects.toThrow();
    });
  });

  describe('findByHash / findActiveByHash', () => {
    it('finds a token by hash regardless of revocation state', async () => {
      const user = await fixtureUser();
      const token = await create(user.id);

      const found = await repository.findByHash(token.tokenHash);
      expect(found?.id).toBe(token.id);
    });

    it('findActiveByHash excludes a revoked token', async () => {
      const user = await fixtureUser();
      const token = await create(user.id);
      await repository.revoke(token);

      const active = await repository.findActiveByHash(token.tokenHash);
      expect(active).toBeNull();

      const any = await repository.findByHash(token.tokenHash);
      expect(any?.revokedAt).not.toBeNull();
    });
  });

  describe('countActiveByUserId', () => {
    it('counts only unrevoked, unexpired tokens for the user', async () => {
      const user = await fixtureUser();
      const active = await create(user.id);
      const revoked = await create(user.id);
      await repository.revoke(revoked);
      await create(user.id, { expiresAt: new Date(Date.now() - 1000) }); // expired

      const count = await repository.countActiveByUserId(user.id);

      expect(count).toBe(1);
      const activeCheck = await repository.findActiveByHash(active.tokenHash);
      expect(activeCheck).not.toBeNull();
    });
  });

  describe('revokeOldestActiveSessions', () => {
    it('revokes exactly the oldest N active sessions, newest left standing', async () => {
      const user = await fixtureUser();
      const first = await create(user.id);
      await sleep1ms();
      const second = await create(user.id);
      await sleep1ms();
      const third = await create(user.id);

      await repository.revokeOldestActiveSessions(user.id, 2);

      const [reloadedFirst, reloadedSecond, reloadedThird] = await Promise.all([
        repository.findByHash(first.tokenHash),
        repository.findByHash(second.tokenHash),
        repository.findByHash(third.tokenHash),
      ]);

      expect(reloadedFirst!.revokedAt).not.toBeNull();
      expect(reloadedSecond!.revokedAt).not.toBeNull();
      expect(reloadedThird!.revokedAt).toBeNull();
    });

    it('is a no-op for a count of zero', async () => {
      const user = await fixtureUser();
      const token = await create(user.id);

      await repository.revokeOldestActiveSessions(user.id, 0);

      const reloaded = await repository.findByHash(token.tokenHash);
      expect(reloaded!.revokedAt).toBeNull();
    });
  });

  describe('revokeAllActiveForUser', () => {
    it('revokes every active session but leaves an already-revoked one untouched', async () => {
      const user = await fixtureUser();
      const active = await create(user.id);
      const alreadyRevoked = await create(user.id);
      const revokedAt = new Date(Date.now() - 60_000);
      await repository.revoke(alreadyRevoked, revokedAt);

      await repository.revokeAllActiveForUser(user.id);

      const [reloadedActive, reloadedOld] = await Promise.all([
        repository.findByHash(active.tokenHash),
        repository.findByHash(alreadyRevoked.tokenHash),
      ]);
      expect(reloadedActive!.revokedAt).not.toBeNull();
      // The already-revoked row's original timestamp is untouched, not
      // overwritten by this second call — proves the WHERE clause excludes it.
      expect(reloadedOld!.revokedAt!.getTime()).toBe(revokedAt.getTime());
    });
  });

  describe('revokeFamily (reuse-detection invalidation)', () => {
    it('revokes every token sharing a family_id, ignoring other families', async () => {
      const user = await fixtureUser();
      const familyId = randomUUID();
      const memberA = await create(user.id, { familyId });
      const memberB = await create(user.id, { familyId });
      const otherFamily = await create(user.id);

      await repository.revokeFamily(familyId);

      const [reloadedA, reloadedB, reloadedOther] = await Promise.all([
        repository.findByHash(memberA.tokenHash),
        repository.findByHash(memberB.tokenHash),
        repository.findByHash(otherFamily.tokenHash),
      ]);
      expect(reloadedA!.revokedAt).not.toBeNull();
      expect(reloadedB!.revokedAt).not.toBeNull();
      expect(reloadedOther!.revokedAt).toBeNull();
    });
  });

  describe('cascade behaviour', () => {
    it('deletes refresh_tokens rows when the owning user is deleted (ON DELETE CASCADE)', async () => {
      const user = await createFixtureUser(ds);
      const token = await create(user.id);

      await deleteFixtureUser(ds, user.id);
      // Remove from the afterAll cleanup list — it no longer exists.
      const idx = createdUserIds.indexOf(user.id);
      if (idx >= 0) createdUserIds.splice(idx, 1);

      const orphan = await repository.findByHash(token.tokenHash);
      expect(orphan).toBeNull();
    });

    it('SETs replaced_by_id NULL rather than cascading when the replacement token is deleted', async () => {
      const user = await fixtureUser();
      const original = await create(user.id);
      const replacement = await create(user.id);
      await ds.getRepository(RefreshToken).update(original.id, {
        replacedById: replacement.id,
      });

      await ds.getRepository(RefreshToken).delete(replacement.id);

      const reloadedOriginal = await repository.findByHash(original.tokenHash);
      expect(reloadedOriginal).not.toBeNull();
      expect(reloadedOriginal!.replacedById).toBeNull();
    });
  });
});

function sleep1ms(): Promise<void> {
  // createdAt has second-level precision variance under load; a real delay
  // keeps ORDER BY createdAt ASC deterministic across the three fixtures.
  return new Promise((resolve) => setTimeout(resolve, 5));
}
