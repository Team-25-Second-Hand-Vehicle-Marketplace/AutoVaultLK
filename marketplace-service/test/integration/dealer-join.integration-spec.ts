import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ImageUrlResolverService } from '../../src/modules/images/services/image-url-resolver.service';
import { VehicleSearchRepository } from '../../src/modules/search/repositories/vehicle-search.repository';
import { buildFilterQuery } from '../../src/modules/search/filters/filter-query.builder';
import type { FilterSearchDto } from '../../src/modules/search/dto/filter-search.dto';
import {
  connect,
  describeWithDatabase,
  disconnect,
  itWithData,
  queryRow,
  queryRows,
} from './test-database';

/**
 * The cross-schema reads into `auth`.
 *
 * FR-18.1 specifies a local read model fed by DealerApproved events. The code
 * reads `auth.dealer_profiles` directly instead — a deliberate choice recorded
 * in Documentation/plan-b-reads-cross-schemas.md, and the reason this suite
 * earns its place: marketplace now depends on another service's schema and on
 * grants it does not own. Neither dependency is visible to a unit test, and
 * both break silently.
 *
 * Connecting as `marketplace_service_role` rather than the owner is what makes
 * the grant half of that real: as the owner these queries would pass whether or
 * not database/src/grants.sql had ever run.
 */
describeWithDatabase('cross-schema dealer reads (integration)', () => {
  let ds: DataSource;
  let repository: VehicleSearchRepository;
  let liveCount = 0;

  const dto = (overrides: Partial<FilterSearchDto> = {}): FilterSearchDto => ({
    page: 1,
    limit: 20,
    ...overrides,
  });

  beforeAll(async () => {
    const connection = await connect();
    if (!connection)
      throw new Error('Database became unreachable after the probe');
    ds = connection;
    // demo mode (no IMAGE_SERVE_MODE set) — this suite is about the auth
    // cross-schema join, not image resolution, so the resolver runs for
    // real but every image resolves to null, same as an unconfigured
    // deployment.
    repository = new VehicleSearchRepository(
      ds,
      new ImageUrlResolverService(new ConfigService({})),
    );

    const { count } = await queryRow<{ count: string }>(
      ds,
      `SELECT COUNT(*) AS count FROM marketplace.vehicles WHERE status = 'LIVE'`,
    );
    liveCount = parseInt(count, 10);
  });

  afterAll(async () => {
    await disconnect();
  });

  const hasVehicles = () => liveCount > 0;

  describe('grants', () => {
    // If this fails, grants.sql has not been applied — every dealer badge and
    // every verified-only search would 500 in the running service.
    it('can read auth.dealer_profiles as the marketplace role', async () => {
      const rows = await queryRows<{ count: string }>(
        ds,
        `SELECT COUNT(*) AS count FROM auth.dealer_profiles`,
      );

      expect(parseInt(rows[0].count, 10)).toBeGreaterThanOrEqual(0);
    });

    it('can read auth.users as the marketplace role', async () => {
      const rows = await queryRows<{ count: string }>(
        ds,
        `SELECT COUNT(*) AS count FROM auth.users`,
      );

      expect(parseInt(rows[0].count, 10)).toBeGreaterThanOrEqual(0);
    });

    // ADR-002: the reads are deliberate, the writes are not. A marketplace role
    // that can write into auth has lost the boundary the deviation kept.
    it('cannot write to auth.dealer_profiles', async () => {
      await expect(
        ds.query(`UPDATE auth.dealer_profiles SET city = city WHERE false`),
      ).rejects.toThrow();
    });
  });

  describe('columns the join depends on', () => {
    // The join names these explicitly. auth-user-service owns the table, so a
    // rename there breaks marketplace with nothing in marketplace's own tests
    // to catch it. This is the drift guard.
    it.each([
      'user_id',
      'company_name',
      'city',
      'contact_number',
      'verification_status',
    ])('auth.dealer_profiles still has %s', async (column) => {
      const rows = await queryRows<{ column_name: string }>(
        ds,
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'auth' AND table_name = 'dealer_profiles'
            AND column_name = $1`,
        [column],
      );

      expect(rows).toHaveLength(1);
    });
  });

  describe('dealer summary on search results (FR-18)', () => {
    itWithData(
      'attaches a verification flag to every result',
      hasVehicles,
      async () => {
        const query = dto({ limit: 10 });

        const results = await repository.search(buildFilterQuery(query), query);

        expect(results.length).toBeGreaterThan(0);
        for (const row of results) {
          expect(typeof row.dealerVerified).toBe('boolean');
        }
      },
    );

    // A LEFT JOIN: a listing whose dealer profile is missing must still appear,
    // unverified, rather than vanishing from the catalogue.
    itWithData(
      'keeps a listing whose dealer has no profile',
      hasVehicles,
      async () => {
        const { count } = await queryRow<{ count: string }>(
          ds,
          `SELECT COUNT(*) AS count
           FROM marketplace.vehicles v
           LEFT JOIN auth.dealer_profiles dp ON dp.user_id = v.dealer_id
          WHERE v.status = 'LIVE' AND dp.user_id IS NULL`,
        );

        const orphaned = parseInt(count, 10);
        const query = dto({ limit: 100 });
        const results = await repository.search(buildFilterQuery(query), query);

        // Whether or not the seed has orphans, the LEFT JOIN must not have
        // dropped rows: the result count matches an unjoined count.
        const { total } = await queryRow<{ total: string }>(
          ds,
          `SELECT COUNT(*) AS total FROM marketplace.vehicles WHERE status = 'LIVE'`,
        );

        expect(results.length).toBe(Math.min(100, parseInt(total, 10)));
        expect(orphaned).toBeGreaterThanOrEqual(0);
      },
    );
  });

  describe('verified-only filter', () => {
    // This one switches the LEFT JOIN for an INNER JOIN on a second alias.
    // Getting that wrong returns unverified dealers to buyers who asked not to
    // see them.
    itWithData(
      'returns only listings from VERIFIED dealers',
      hasVehicles,
      async () => {
        const query = dto({ verifiedDealersOnly: true, limit: 50 });

        const results = await repository.search(buildFilterQuery(query), query);

        if (results.length === 0) {
          console.warn('[skipped: no verified dealers in the seed]');
          return;
        }

        const rows = await queryRows<{ status: string }>(
          ds,
          `SELECT DISTINCT dp.verification_status AS status
           FROM marketplace.vehicles v
           JOIN auth.dealer_profiles dp ON dp.user_id = v.dealer_id
          WHERE v.id = ANY($1)`,
          [results.map((r) => r.id)],
        );

        expect(rows.map((r) => r.status)).toEqual(['VERIFIED']);
        for (const row of results) {
          expect(row.dealerVerified).toBe(true);
        }
      },
    );

    itWithData(
      'returns fewer rows than an unfiltered search',
      hasVehicles,
      async () => {
        const { unverified } = await queryRow<{ unverified: string }>(
          ds,
          `SELECT COUNT(*) AS unverified
           FROM marketplace.vehicles v
           JOIN auth.dealer_profiles dp ON dp.user_id = v.dealer_id
          WHERE v.status = 'LIVE' AND dp.verification_status <> 'VERIFIED'`,
        );

        if (parseInt(unverified, 10) === 0) {
          console.warn('[skipped: every seeded dealer is verified]');
          return;
        }

        const all = dto({ limit: 200 });
        const verifiedOnly = dto({ verifiedDealersOnly: true, limit: 200 });

        const [everything, verified] = await Promise.all([
          repository.count(buildFilterQuery(all)),
          repository.count(buildFilterQuery(verifiedOnly), true),
        ]);

        expect(verified).toBeLessThan(everything);
      },
    );

    // The verified filter pushes an extra parameter onto the list; an
    // off-by-one in its index silently filters on the wrong value.
    itWithData(
      'keeps parameter indexes correct alongside filters',
      hasVehicles,
      async () => {
        const query = dto({
          verifiedDealersOnly: true,
          minPrice: 500_000,
          maxPrice: 20_000_000,
          limit: 20,
        });

        const results = await repository.search(buildFilterQuery(query), query);

        for (const row of results) {
          expect(row.price).toBeGreaterThanOrEqual(500_000);
          expect(row.price).toBeLessThanOrEqual(20_000_000);
          expect(row.dealerVerified).toBe(true);
        }
      },
    );
  });

  describe('dealer detail on a vehicle page (FR-18)', () => {
    itWithData(
      'joins the dealer profile onto the detail view',
      hasVehicles,
      async () => {
        const rows = await queryRows<{ id: string }>(
          ds,
          `SELECT v.id
           FROM marketplace.vehicles v
           JOIN auth.dealer_profiles dp ON dp.user_id = v.dealer_id
          WHERE v.status = 'LIVE'
          LIMIT 1`,
        );

        if (rows.length === 0) {
          console.warn('[skipped: no LIVE vehicle with a dealer profile]');
          return;
        }

        const detail = await repository.findById(rows[0].id);

        expect(detail).not.toBeNull();
        expect(detail!.dealer.id).toBeTruthy();
        // company_name, city and contact_number all come from the auth schema.
        expect(detail!.dealer).toHaveProperty('companyName');
        expect(detail!.dealer).toHaveProperty('city');
        expect(detail!.dealer).toHaveProperty('contactNumber');
        expect(typeof detail!.dealer.verified).toBe('boolean');
      },
    );
  });
});
