import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { NotificationsRepository } from '../../src/modules/notifications/repositories/notifications.repository';
import { AuthUserView } from '../../src/infrastructure/database/entities/auth-user.view-entity';
import { Notification } from '../../src/infrastructure/database/entities/notification.entity';
import { connect, describeWithDatabase, disconnect, repositoryFor } from './test-database';

describeWithDatabase('NotificationsRepository (integration)', () => {
  let ds: DataSource;
  let repository: NotificationsRepository;
  let someUserId: string | null = null;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const connection = await connect();
    if (!connection)
      throw new Error('Database became unreachable after the probe');
    ds = connection;
    repository = new NotificationsRepository(
      repositoryFor(ds, Notification),
      repositoryFor(ds, AuthUserView),
    );

    const [user] = await ds.query<{ id: string }[]>(
      `SELECT id FROM auth.users LIMIT 1`,
    );
    someUserId = user?.id ?? null;
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await ds.query(`DELETE FROM notification.notifications WHERE id = ANY($1)`, [
        createdIds,
      ]);
    }
    await disconnect();
  });

  const create = async (
    overrides: Partial<Parameters<typeof repository.createPending>[0]> = {},
  ) => {
    const saved = await repository.createPending({
      userId: someUserId!,
      type: 'UPLOAD_COMPLETED',
      subject: 'Your upload finished',
      message: 'Integration test fixture',
      payload: {},
      idempotencyKey: `integration-test-${randomUUID()}`,
      ...overrides,
    });
    createdIds.push(saved.id);
    return saved;
  };

  describe('grants', () => {
    // If this fails, grants.sql has not granted notification_service_role
    // SELECT on auth — sending a notification (it needs the recipient's
    // email) would 500 in the running service.
    it('can read auth.users as notification_service_role', async () => {
      const count = await ds.getRepository(AuthUserView).count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('cannot write to auth.users', async () => {
      await expect(
        ds.query(`UPDATE auth.users SET name = name WHERE false`),
      ).rejects.toThrow();
    });
  });

  describe('createPending / findByIdempotencyKey', () => {
    it('persists a row that round-trips through findByIdempotencyKey', async () => {
      if (!someUserId) {
        console.warn('[skipped: no auth.users row in the seed]');
        return;
      }
      const key = `integration-test-${randomUUID()}`;
      const saved = await create({ idempotencyKey: key });

      const found = await repository.findByIdempotencyKey(key);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(saved.id);
      expect(found!.status).toBe('PENDING');
    });

    // idempotency_key is a real unique constraint (nullable, but unique when
    // present) — this is what makes a replayed queue message a no-op instead
    // of a duplicate send.
    it('rejects a second row with the same idempotency_key', async () => {
      if (!someUserId) {
        console.warn('[skipped: no auth.users row in the seed]');
        return;
      }
      const key = `integration-test-dup-${randomUUID()}`;
      await create({ idempotencyKey: key });

      await expect(create({ idempotencyKey: key })).rejects.toThrow();
    });
  });

  describe('findUser', () => {
    it('resolves a recipient by id for a real seeded user', async () => {
      if (!someUserId) {
        console.warn('[skipped: no auth.users row in the seed]');
        return;
      }
      const user = await repository.findUser(someUserId);

      expect(user).not.toBeNull();
      expect(user!.id).toBe(someUserId);
      expect(typeof user!.email).toBe('string');
    });

    it('returns null for an id with no matching user', async () => {
      const user = await repository.findUser('00000000-0000-0000-0000-000000000000');
      expect(user).toBeNull();
    });
  });

  describe('markSent / markFailed / scheduleRetry', () => {
    it('markSent clears nextAttemptAt and lastError', async () => {
      if (!someUserId) {
        console.warn('[skipped: no auth.users row in the seed]');
        return;
      }
      const saved = await create();
      await repository.scheduleRetry(saved.id, 1, new Date(Date.now() + 60_000), 'transient');

      await repository.markSent(saved.id);

      const row = await repository.findById(saved.id);
      expect(row!.status).toBe('SENT');
      expect(row!.sentAt).not.toBeNull();
      expect(row!.nextAttemptAt).toBeNull();
      expect(row!.lastError).toBeNull();
    });

    it('markFailed clamps an oversized error message to the 500-char column', async () => {
      if (!someUserId) {
        console.warn('[skipped: no auth.users row in the seed]');
        return;
      }
      const saved = await create();
      const longError = 'x'.repeat(1000);

      await repository.markFailed(saved.id, longError);

      const row = await repository.findById(saved.id);
      expect(row!.status).toBe('FAILED');
      expect(row!.lastError!.length).toBeLessThanOrEqual(500);
    });

    it('scheduleRetry keeps status PENDING — a retry is not a failure', async () => {
      if (!someUserId) {
        console.warn('[skipped: no auth.users row in the seed]');
        return;
      }
      const saved = await create();
      const nextAttemptAt = new Date(Date.now() + 30_000);

      await repository.scheduleRetry(saved.id, 2, nextAttemptAt, 'timeout');

      const row = await repository.findById(saved.id);
      expect(row!.status).toBe('PENDING');
      expect(row!.attemptCount).toBe(2);
      expect(row!.nextAttemptAt?.getTime()).toBe(nextAttemptAt.getTime());
    });
  });

  describe('claimDueRetries (FOR UPDATE SKIP LOCKED)', () => {
    it('claims only rows that are PENDING with a past-due nextAttemptAt', async () => {
      if (!someUserId) {
        console.warn('[skipped: no auth.users row in the seed]');
        return;
      }
      const due = await create();
      await repository.scheduleRetry(due.id, 1, new Date(Date.now() - 1000), 'past due');

      const notYetDue = await create();
      await repository.scheduleRetry(
        notYetDue.id,
        1,
        new Date(Date.now() + 60_000),
        'future',
      );

      const alreadySent = await create();
      await repository.markSent(alreadySent.id);

      const claimed = await repository.claimDueRetries(50, new Date());
      const claimedIds = claimed.map((n) => n.id);

      expect(claimedIds).toContain(due.id);
      expect(claimedIds).not.toContain(notYetDue.id);
      expect(claimedIds).not.toContain(alreadySent.id);
    });

    it('clears nextAttemptAt on claim, so a claimed row is not claimed twice', async () => {
      if (!someUserId) {
        console.warn('[skipped: no auth.users row in the seed]');
        return;
      }
      const due = await create();
      await repository.scheduleRetry(due.id, 1, new Date(Date.now() - 1000), 'past due');

      const firstClaim = await repository.claimDueRetries(50, new Date());
      expect(firstClaim.map((n) => n.id)).toContain(due.id);

      const secondClaim = await repository.claimDueRetries(50, new Date());
      expect(secondClaim.map((n) => n.id)).not.toContain(due.id);
    });

    // FR-53's exactly-once guarantee under more than one replica rests
    // entirely on SKIP LOCKED. Two concurrent claimers racing for the same
    // due row must partition it between them, never both receive it — a
    // unit test cannot observe locking behaviour at all, only a real
    // Postgres transaction can.
    it('splits due rows between two concurrent claimers with no overlap', async () => {
      if (!someUserId) {
        console.warn('[skipped: no auth.users row in the seed]');
        return;
      }
      const dueIds: string[] = [];
      for (let i = 0; i < 6; i++) {
        const row = await create();
        await repository.scheduleRetry(row.id, 1, new Date(Date.now() - 1000), 'past due');
        dueIds.push(row.id);
      }

      const [claimA, claimB] = await Promise.all([
        repository.claimDueRetries(3, new Date()),
        repository.claimDueRetries(3, new Date()),
      ]);

      const idsA = claimA.map((n) => n.id);
      const idsB = claimB.map((n) => n.id);
      const overlap = idsA.filter((id) => idsB.includes(id));

      expect(overlap).toHaveLength(0);

      const claimedFromThisBatch = [...idsA, ...idsB].filter((id) =>
        dueIds.includes(id),
      );
      expect(new Set(claimedFromThisBatch).size).toBe(claimedFromThisBatch.length);
    });
  });
});
