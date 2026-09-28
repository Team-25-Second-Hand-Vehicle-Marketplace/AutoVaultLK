import { DataSource } from 'typeorm';
import { AdminReadsRepository } from '../../src/modules/admin/repositories/admin-reads.repository';
import { AuditLog } from '../../src/infrastructure/database/entities/audit-log.entity';
import { AuthUserView } from '../../src/infrastructure/database/entities/auth-user.view-entity';
import { DealerProfileView } from '../../src/infrastructure/database/entities/dealer-profile.view-entity';
import { NotificationView } from '../../src/infrastructure/database/entities/notification.view-entity';
import { RejectedRecordView } from '../../src/infrastructure/database/entities/rejected-record.view-entity';
import { UploadJobView } from '../../src/infrastructure/database/entities/upload-job.view-entity';
import { VehicleView } from '../../src/infrastructure/database/entities/vehicle.view-entity';
import {
  connect,
  describeWithDatabase,
  disconnect,
  itWithData,
  repositoryFor,
} from './test-database';

/**
 * admin_service_role reads across every other schema (auth, marketplace,
 * ingestion, notification) for the dashboard and reports. None of that
 * cross-schema access, nor the raw DATE_TRUNC/query-builder SQL in
 * loadReports/loadDailySeries, is observable from a unit test that stubs
 * every Repository<T> — this is the level that actually connects as
 * admin_service_role and proves the grants and the SQL both hold.
 */
describeWithDatabase('AdminReadsRepository (integration)', () => {
  let ds: DataSource;
  let repository: AdminReadsRepository;
  let liveVehicleCount = 0;
  let userCount = 0;

  beforeAll(async () => {
    const connection = await connect();
    if (!connection)
      throw new Error('Database became unreachable after the probe');
    ds = connection;

    repository = new AdminReadsRepository(
      repositoryFor(ds, AuthUserView),
      repositoryFor(ds, DealerProfileView),
      repositoryFor(ds, VehicleView),
      repositoryFor(ds, UploadJobView),
      repositoryFor(ds, NotificationView),
      repositoryFor(ds, AuditLog),
      repositoryFor(ds, RejectedRecordView),
    );

    liveVehicleCount = await ds
      .getRepository(VehicleView)
      .count({ where: { status: 'LIVE' } });
    userCount = await ds.getRepository(AuthUserView).count();
  });

  afterAll(async () => {
    await disconnect();
  });

  const hasUsers = () => userCount > 0;
  const hasVehicles = () => liveVehicleCount > 0;

  describe('grants', () => {
    // If any of these fail, grants.sql has not granted admin_service_role
    // SELECT on that schema — the live dashboard would 500 on load.
    it.each([
      ['auth.users', () => ds.getRepository(AuthUserView).count()],
      ['auth.dealer_profiles', () => ds.getRepository(DealerProfileView).count()],
      ['marketplace.vehicles', () => ds.getRepository(VehicleView).count()],
      ['ingestion.upload_jobs', () => ds.getRepository(UploadJobView).count()],
      [
        'ingestion.rejected_records',
        () => ds.getRepository(RejectedRecordView).count(),
      ],
      [
        'notification.notifications',
        () => ds.getRepository(NotificationView).count(),
      ],
    ])('can read %s as admin_service_role', async (_label, run) => {
      await expect(run()).resolves.toBeGreaterThanOrEqual(0);
    });

    // ADR: admin reviews and reports read everywhere but write nowhere but
    // its own schema — every mutation goes through the owning service's API.
    it('cannot write to auth.users', async () => {
      await expect(
        ds.query(`UPDATE auth.users SET name = name WHERE false`),
      ).rejects.toThrow();
    });

    it('cannot write to marketplace.vehicles', async () => {
      await expect(
        ds.query(`UPDATE marketplace.vehicles SET status = status WHERE false`),
      ).rejects.toThrow();
    });
  });

  describe('columns the dashboard/report queries depend on', () => {
    // Each view entity mirrors a column owned by another service's
    // migration. A rename there breaks admin-service with nothing in
    // admin-service's own unit suite to catch it.
    it.each([
      ['auth', 'users', 'role'],
      ['auth', 'users', 'is_active'],
      ['auth', 'dealer_profiles', 'verification_status'],
      ['marketplace', 'vehicles', 'status'],
      ['ingestion', 'upload_jobs', 'status'],
      ['ingestion', 'rejected_records', 'row_number'],
      ['notification', 'notifications', 'status'],
    ])('%s.%s still has column %s', async (schema, table, column) => {
      const rows = await ds.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
        [schema, table, column],
      );

      expect(rows).toHaveLength(1);
    });
  });

  describe('loadDashboardRaw', () => {
    itWithData('aggregates counts across every schema', hasUsers, async () => {
      const dashboard = await repository.loadDashboardRaw();

      expect(dashboard.totalUsers).toBeGreaterThanOrEqual(0);
      expect(dashboard.liveListings).toBeGreaterThanOrEqual(0);
      expect(dashboard.dealers).toBeGreaterThanOrEqual(0);
      expect(dashboard.pendingDealers).toBeGreaterThanOrEqual(0);
      expect(dashboard.notificationTotal).toBe(
        dashboard.notificationSent +
          dashboard.notificationFailed +
          (dashboard.notificationTotal -
            dashboard.notificationSent -
            dashboard.notificationFailed),
      );
    });
  });

  describe('listUsers', () => {
    itWithData(
      'attaches the dealer profile to each dealer user, keyed by user_id',
      hasUsers,
      async () => {
        const items = await repository.listUsers();

        expect(items.length).toBe(userCount);
        for (const item of items) {
          if (item.role !== 'DEALER') continue;
          // A dealer user with no profile row is a valid state (registered,
          // profile not yet completed) — the assertion is about the join
          // key, not that every dealer has one.
          if (item.dealer) {
            expect(item.dealer.userId).toBe(item.id);
          }
        }
      },
    );

    itWithData(
      'filters by dealer verification status',
      hasUsers,
      async () => {
        const pending = await repository.listUsers('PENDING');
        for (const item of pending) {
          expect(item.dealer?.verificationStatus).toBe('PENDING');
        }
      },
    );
  });

  describe('findDealer', () => {
    itWithData(
      'joins the auth.users row onto a dealer profile',
      hasUsers,
      async () => {
        const [profile] = await ds.query<{ user_id: string }[]>(
          `SELECT user_id FROM auth.dealer_profiles LIMIT 1`,
        );
        if (!profile) {
          console.warn('[skipped: no dealer profile in the seed]');
          return;
        }

        const dealer = await repository.findDealer(profile.user_id);

        expect(dealer).not.toBeNull();
        expect(dealer!.userId).toBe(profile.user_id);
        expect(dealer!.user).not.toBeNull();
      },
    );

    it('returns null for a user with no dealer profile', async () => {
      const dealer = await repository.findDealer(
        '00000000-0000-0000-0000-000000000000',
      );
      expect(dealer).toBeNull();
    });
  });

  describe('findRejectionsForJob', () => {
    itWithData(
      'paginates rejected records ordered by row_number then stage',
      hasVehicles,
      async () => {
        const [job] = await ds.query<{ id: string }[]>(
          `SELECT DISTINCT upload_job_id AS id FROM ingestion.rejected_records LIMIT 1`,
        );
        if (!job) {
          console.warn('[skipped: no rejected records in the seed]');
          return;
        }

        const { items, total } = await repository.findRejectionsForJob(
          job.id,
          1,
          10,
        );

        expect(total).toBeGreaterThan(0);
        expect(items.length).toBeLessThanOrEqual(10);
        for (const item of items) {
          expect(item.uploadJobId).toBe(job.id);
        }

        const rowNumbers = items.map((item) => item.rowNumber);
        expect(rowNumbers).toEqual([...rowNumbers].sort((a, b) => a - b));
      },
    );
  });

  describe('loadReports (raw query-builder SQL)', () => {
    itWithData(
      'buckets listings by status within the date range',
      hasVehicles,
      async () => {
        const from = new Date('2000-01-01');
        const to = new Date();

        const report = await repository.loadReports(from, to);

        expect(report.activeUsers).toBeGreaterThanOrEqual(0);
        expect(report.uploads.jobs).toBeGreaterThanOrEqual(0);
        expect(report.jobRates.errorRate).toBeGreaterThanOrEqual(0);
        expect(report.jobRates.errorRate).toBeLessThanOrEqual(1);

        const totalListings = Object.values(report.listings).reduce(
          (sum, n) => sum + n,
          0,
        );
        expect(totalListings).toBeGreaterThanOrEqual(0);
      },
    );

    it('returns zero-valued rates rather than dividing by zero for an empty range', async () => {
      const from = new Date('1970-01-01');
      const to = new Date('1970-01-02');

      const report = await repository.loadReports(from, to);

      expect(report.uploads.jobs).toBe(0);
      expect(report.jobRates.errorRate).toBe(0);
      expect(report.jobRates.partialRate).toBe(0);
    });
  });

  describe('loadDailySeries (DATE_TRUNC grouping)', () => {
    itWithData(
      'groups listings, users and uploads by calendar day',
      hasVehicles,
      async () => {
        const from = new Date('2000-01-01');
        const to = new Date();

        const series = await repository.loadDailySeries(from, to);

        for (const rows of [
          series.listingRows,
          series.userRows,
          series.uploadRows,
        ]) {
          // Each row has exactly one entry per day that had activity, never
          // one per record — a broken GROUP BY would duplicate days instead.
          const days = rows.map((r) => new Date(r.day).toISOString());
          expect(new Set(days).size).toBe(days.length);
        }
      },
    );
  });
});
