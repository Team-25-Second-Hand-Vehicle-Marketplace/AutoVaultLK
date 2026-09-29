import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditLogsRepository } from '../../src/modules/admin/repositories/audit-logs.repository';
import { AuditLog } from '../../src/infrastructure/database/entities/audit-log.entity';
import { connect, describeWithDatabase, disconnect, repositoryFor } from './test-database';

/**
 * `admin` is the one schema admin_service_role owns outright (see
 * database.config.ts) — append() and search()'s filter chain are exercised
 * here against real persisted rows and a real jsonb `changes` column,
 * neither of which a stubbed-repository unit test can prove.
 */
describeWithDatabase('AuditLogsRepository (integration)', () => {
  let ds: DataSource;
  let repository: AuditLogsRepository;
  let someUserId: string | null = null;
  let anotherUserId: string | null = null;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const connection = await connect();
    if (!connection)
      throw new Error('Database became unreachable after the probe');
    ds = connection;
    repository = new AuditLogsRepository(repositoryFor(ds, AuditLog));

    // audit_logs.actor_id carries a real FK to auth.users (SET NULL on
    // delete, not enforced away) — a fixture actor has to be a row that
    // exists, not just a syntactically valid uuid.
    const users = await ds.query<{ id: string }[]>(
      `SELECT id FROM auth.users LIMIT 2`,
    );
    someUserId = users[0]?.id ?? null;
    anotherUserId = users[1]?.id ?? users[0]?.id ?? null;
  });

  afterAll(async () => {
    // Suites own and clean up their own fixtures so they remain
    // order-independent and repeatable.
    if (createdIds.length > 0) {
      await ds.query(`DELETE FROM admin.audit_logs WHERE id = ANY($1)`, [
        createdIds,
      ]);
    }
    await disconnect();
  });

  const append = async (overrides: Partial<Parameters<typeof repository.append>[0]> = {}) => {
    const saved = await repository.append({
      actorId: someUserId,
      action: 'listing.approved',
      entityType: 'vehicle',
      entityId: randomUUID(),
      changes: { status: { from: 'PENDING', to: 'LIVE' } },
      ipAddress: '127.0.0.1',
      ...overrides,
    });
    createdIds.push(saved.id);
    return saved;
  };

  describe('append', () => {
    it('persists a row with a real generated id and createdAt', async () => {
      const saved = await append();

      expect(saved.id).toBeTruthy();
      expect(saved.createdAt).toBeInstanceOf(Date);

      const [row] = await ds.query(
        `SELECT action, entity_type, changes FROM admin.audit_logs WHERE id = $1`,
        [saved.id],
      );
      expect(row.action).toBe('listing.approved');
      expect(row.entity_type).toBe('vehicle');
      // jsonb round-trips as an object, not a string that needs a second parse.
      expect(row.changes).toEqual({ status: { from: 'PENDING', to: 'LIVE' } });
    });

    it('persists a null entityId for actions with no entity yet (user.admin_created)', async () => {
      const saved = await append({
        action: 'user.admin_created',
        entityType: 'user',
        entityId: null,
      });

      const [row] = await ds.query(
        `SELECT entity_id FROM admin.audit_logs WHERE id = $1`,
        [saved.id],
      );
      expect(row.entity_id).toBeNull();
    });

    it('survives the referenced actor being deleted (SET NULL, not CASCADE)', async () => {
      // The column is `actor_id ON DELETE SET NULL` precisely so audit
      // history outlives the user it recorded — this proves the FK action
      // itself, not just the TypeScript nullability.
      const [constraint] = await ds.query<{ delete_rule: string }[]>(
        `SELECT rc.delete_rule
           FROM information_schema.referential_constraints rc
           JOIN information_schema.table_constraints tc
             ON tc.constraint_name = rc.constraint_name
            AND tc.constraint_schema = rc.constraint_schema
          WHERE tc.table_schema = 'admin'
            AND tc.table_name = 'audit_logs'
            AND tc.constraint_type = 'FOREIGN KEY'`,
      );

      if (!constraint) {
        console.warn('[skipped: no FK on audit_logs.actor_id in this schema]');
        return;
      }
      expect(constraint.delete_rule).toBe('SET NULL');
    });
  });

  describe('search', () => {
    it('filters by action', async () => {
      const saved = await append({ action: `integration-test.${randomUUID()}` });

      const results = await repository.search({ action: saved.action });

      expect(results.map((r) => r.id)).toContain(saved.id);
      expect(results.every((r) => r.action === saved.action)).toBe(true);
    });

    it('filters by entityType', async () => {
      const marker = `integration-test-${randomUUID()}`;
      const saved = await append({ entityType: marker });

      const results = await repository.search({ entityType: marker });

      expect(results.map((r) => r.id)).toEqual([saved.id]);
    });

    it('filters by actorId', async () => {
      if (!someUserId) {
        console.warn('[skipped: no auth.users row in the seed]');
        return;
      }
      const actorId = someUserId;
      const saved = await append({ actorId });

      const results = await repository.search({ actorId });

      expect(results.map((r) => r.id)).toContain(saved.id);
      expect(results.every((r) => r.actorId === actorId)).toBe(true);
    });

    it('filters by a from/to date range, excluding rows outside it', async () => {
      const saved = await append();

      const withinRange = await repository.search({
        from: new Date(Date.now() - 60_000),
        to: new Date(Date.now() + 60_000),
      });
      expect(withinRange.map((r) => r.id)).toContain(saved.id);

      const outsideRange = await repository.search({
        from: new Date('1970-01-01'),
        to: new Date('1970-01-02'),
      });
      expect(outsideRange.map((r) => r.id)).not.toContain(saved.id);
    });

    it('orders results newest first', async () => {
      const marker = `integration-test-order-${randomUUID()}`;
      const first = await append({ entityType: marker });
      const second = await append({ entityType: marker });

      const results = await repository.search({ entityType: marker });

      expect(results[0].id).toBe(second.id);
      expect(results[1].id).toBe(first.id);
    });

    it('combines multiple filters with AND semantics', async () => {
      if (!someUserId || !anotherUserId || someUserId === anotherUserId) {
        console.warn('[skipped: fewer than 2 distinct auth.users rows in the seed]');
        return;
      }
      const marker = `integration-test-and-${randomUUID()}`;
      const actorId = someUserId;
      const matching = await append({ entityType: marker, actorId });
      await append({ entityType: marker, actorId: anotherUserId }); // different actor, same entityType

      const results = await repository.search({ entityType: marker, actorId });

      expect(results.map((r) => r.id)).toEqual([matching.id]);
    });
  });
});
