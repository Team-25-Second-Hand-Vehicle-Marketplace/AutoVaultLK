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
  embeddingOfSomeVehicle,
  fakeEmbedding,
  itWithData,
  queryRow,
  queryRows,
} from './test-database';

/**
 * The search SQL against a real Postgres.
 *
 * Everything here is a construct the unit suite cannot evaluate: the `::vector`
 * cast and `<=>` distance operator are pgvector's, `word_similarity` is
 * pg_trgm's, and `ts_rank`/`plainto_tsquery` need a real tsvector column. A
 * unit test comparing SQL strings would accept any of them spelled wrongly.
 */
describeWithDatabase('VehicleSearchRepository (integration)', () => {
  let ds: DataSource;
  let repository: VehicleSearchRepository;
  let liveCount = 0;
  let embedded: { id: string; embedding: number[] } | null = null;

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

    // The repository takes an injected DataSource, so it can be constructed
    // directly — no Nest container needed for a query-only class.
    //
    // ImageUrlResolverService runs for real, in demo mode (no
    // IMAGE_SERVE_MODE set in the integration test environment): every
    // resolved imageUrl/thumbnailUrl below is genuinely null, which is the
    // correct, testable behaviour for a database that — per the seeded
    // fixtures — carries no vehicle_images rows at all.
    repository = new VehicleSearchRepository(
      ds,
      new ImageUrlResolverService(new ConfigService({})),
    );

    const { count } = await queryRow<{ count: string }>(
      ds,
      `SELECT COUNT(*) AS count FROM marketplace.vehicles WHERE status = 'LIVE'`,
    );
    liveCount = parseInt(count, 10);

    embedded = await embeddingOfSomeVehicle(ds);
  });

  afterAll(async () => {
    await disconnect();
  });

  const hasVehicles = () => liveCount > 0;
  const hasEmbeddings = () => embedded !== null;

  describe('extensions and schema', () => {
    it('has pgvector and pg_trgm installed', async () => {
      const rows = await queryRows<{ extname: string }>(
        ds,
        `SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')`,
      );

      expect(rows.map((r) => r.extname).sort()).toEqual(['pg_trgm', 'vector']);
    });

    // vector(384) must match EMBEDDING_DIMENSIONS, or every insert fails.
    it('stores embeddings at the dimensionality the shared library asserts', async () => {
      const { dimensions } = await queryRow<{ dimensions: number }>(
        ds,
        `SELECT atttypmod AS dimensions
           FROM pg_attribute
          WHERE attrelid = 'marketplace.vehicles'::regclass
            AND attname = 'embedding'`,
      );

      expect(dimensions).toBe(384);
    });
  });

  describe('structured filters (FR-19)', () => {
    itWithData('returns only LIVE listings', hasVehicles, async () => {
      const results = await repository.search(buildFilterQuery(dto()), dto());

      expect(results.length).toBeGreaterThan(0);

      const ids = results.map((r) => r.id);
      const rows = await queryRows<{ status: string }>(
        ds,
        `SELECT DISTINCT status FROM marketplace.vehicles WHERE id = ANY($1)`,
        [ids],
      );

      expect(rows.map((r) => r.status)).toEqual(['LIVE']);
    });

    itWithData(
      'applies a price range in SQL, not in memory',
      hasVehicles,
      async () => {
        const query = dto({ minPrice: 1_000_000, maxPrice: 5_000_000 });

        const results = await repository.search(buildFilterQuery(query), query);

        for (const row of results) {
          expect(row.price).toBeGreaterThanOrEqual(1_000_000);
          expect(row.price).toBeLessThanOrEqual(5_000_000);
        }
      },
    );

    itWithData('filters by make', hasVehicles, async () => {
      const { make } = await queryRow<{ make: string }>(
        ds,
        `SELECT make FROM marketplace.vehicles WHERE status = 'LIVE' GROUP BY make
          ORDER BY COUNT(*) DESC LIMIT 1`,
      );

      // `make` is string[] on the DTO — the HTTP layer's @Transform(toArray())
      // widens a single value, and calling the repository directly skips it.
      const query = dto({ make: [make] });
      const results = await repository.search(buildFilterQuery(query), query);

      expect(results.length).toBeGreaterThan(0);
      for (const row of results) {
        expect(row.make.toLowerCase()).toBe(make.toLowerCase());
      }
    });

    // specs is JSONB; the containment operator behaves unlike a column compare.
    itWithData('filters on a JSONB spec key', hasVehicles, async () => {
      const rows = await queryRows<{ body_type: string }>(
        ds,
        `SELECT specs->>'body_type' AS body_type
           FROM marketplace.vehicles
          WHERE status = 'LIVE' AND specs->>'body_type' IS NOT NULL
          LIMIT 1`,
      );

      if (rows.length === 0) {
        console.warn('[skipped: no body_type in seeded specs]');
        return;
      }

      // Spec filters go through the JSONB containment operator (`@>`), not a
      // column compare — a different code path with its own cast.
      const query = dto({
        specs: [{ key: 'body_type', value: rows[0].body_type }],
      });
      const results = await repository.search(buildFilterQuery(query), query);

      expect(results.length).toBeGreaterThan(0);
      for (const row of results) {
        expect(row.specs.body_type).toBe(rows[0].body_type);
      }
    });

    itWithData(
      'counts the same rows the search returns',
      hasVehicles,
      async () => {
        const query = dto({ limit: 5 });
        const built = buildFilterQuery(query);

        const [results, total] = await Promise.all([
          repository.search(built, query),
          repository.count(built),
        ]);

        expect(results).toHaveLength(Math.min(5, total));
        expect(total).toBe(liveCount);
      },
    );
  });

  describe('pagination and sorting (FR-20)', () => {
    itWithData('orders by price ascending', hasVehicles, async () => {
      const query = dto({ sort: 'price_asc', limit: 10 });

      const results = await repository.search(buildFilterQuery(query), query);
      const prices = results.map((r) => r.price);

      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });

    itWithData(
      'orders by year descending using the effective year',
      hasVehicles,
      async () => {
        // COALESCE(registration_year, manufacture_year) — a row with a NULL
        // registration year must still sort by the year it actually has.
        const query = dto({ sort: 'year_desc', limit: 10 });

        const results = await repository.search(buildFilterQuery(query), query);
        const years = results.map((r) => r.effectiveYear);

        expect(years).toEqual([...years].sort((a, b) => b - a));
      },
    );

    itWithData('pages without overlapping', hasVehicles, async () => {
      const first = dto({ sort: 'price_asc', limit: 5, page: 1 });
      const second = dto({ sort: 'price_asc', limit: 5, page: 2 });

      const [pageOne, pageTwo] = await Promise.all([
        repository.search(buildFilterQuery(first), first),
        repository.search(buildFilterQuery(second), second),
      ]);

      const overlap = pageOne
        .map((r) => r.id)
        .filter((id) => pageTwo.some((r) => r.id === id));

      expect(overlap).toEqual([]);
    });
  });

  describe('semantic ranking (FR-22, FR-23)', () => {
    // The cast and the distance operator are the whole point: `<=>` on a
    // mistyped cast raises 42883 at runtime and nowhere earlier.
    itWithData(
      'accepts a pgvector cast and orders by distance',
      hasEmbeddings,
      async () => {
        const query = dto({ limit: 5 });

        const results = await repository.search(
          buildFilterQuery(query),
          query,
          {
            queryEmbedding: embedded!.embedding,
          },
        );

        expect(results.length).toBeGreaterThan(0);
        // Ranked against a row's own embedding, that row is distance 0 and must
        // come first.
        expect(results[0].id).toBe(embedded!.id);
      },
    );

    itWithData(
      'ranks a different query vector differently',
      hasEmbeddings,
      async () => {
        const query = dto({ limit: 5 });

        const [own, other] = await Promise.all([
          repository.search(buildFilterQuery(query), query, {
            queryEmbedding: embedded!.embedding,
          }),
          repository.search(buildFilterQuery(query), query, {
            queryEmbedding: fakeEmbedding(7),
          }),
        ]);

        // A synthetic vector points somewhere else in the space, so the row that
        // was nearest its own embedding should not still lead.
        expect(other[0]?.id).not.toBe(own[0]?.id);
      },
    );

    // FR-23: filters and ranking in one statement, not a filter then a re-sort.
    itWithData(
      'combines a WHERE filter with vector ordering',
      hasEmbeddings,
      async () => {
        const query = dto({ minPrice: 1_000_000, limit: 10 });

        const results = await repository.search(
          buildFilterQuery(query),
          query,
          {
            queryEmbedding: embedded!.embedding,
          },
        );

        for (const row of results) {
          expect(row.price).toBeGreaterThanOrEqual(1_000_000);
        }
      },
    );

    // appendTrigramWhere gates on distance so a vague query cannot surface
    // everything; this is the fix that stopped bikes appearing for car queries.
    itWithData(
      'drops rows beyond the distance gate',
      hasEmbeddings,
      async () => {
        const query = dto({ limit: 50 });

        const ungated = await repository.search(
          buildFilterQuery(query),
          query,
          {
            queryEmbedding: fakeEmbedding(3),
          },
        );
        const gated = await repository.search(buildFilterQuery(query), query, {
          queryEmbedding: fakeEmbedding(3),
          embeddingWhere: true,
        });

        expect(gated.length).toBeLessThanOrEqual(ungated.length);
      },
    );
  });

  describe('trigram fallback (FR-24)', () => {
    // word_similarity's argument order matters and is easy to reverse; a unit
    // test comparing strings would not notice.
    itWithData(
      'ranks by word_similarity without erroring',
      hasVehicles,
      async () => {
        const query = dto({ limit: 5 });

        const results = await repository.search(
          buildFilterQuery(query),
          query,
          {
            trigramQuery: 'toyota',
          },
        );

        expect(Array.isArray(results)).toBe(true);
      },
    );

    itWithData(
      'gates out rows below the similarity floor',
      hasVehicles,
      async () => {
        const query = dto({ limit: 50 });

        const results = await repository.search(
          buildFilterQuery(query),
          query,
          {
            trigramQuery: 'zzzzqqqq',
            trigramWhere: true,
          },
        );

        // Nothing in a vehicle catalogue resembles that string.
        expect(results).toHaveLength(0);
      },
    );

    itWithData(
      'counts consistently with the same gate applied',
      hasVehicles,
      async () => {
        const query = dto({ limit: 50 });
        const built = buildFilterQuery(query);
        const rank = { trigramQuery: 'zzzzqqqq', trigramWhere: true };

        const [results, total] = await Promise.all([
          repository.search(built, query, rank),
          repository.count(built, undefined, rank),
        ]);

        expect(total).toBe(results.length);
      },
    );
  });

  describe('keyword ranking', () => {
    // ts_rank needs a real tsvector column; plainto_tsquery with the wrong
    // configuration name raises at runtime.
    itWithData(
      'ranks with ts_rank over the search vector',
      hasVehicles,
      async () => {
        const query = dto({ q: 'toyota', limit: 5 });

        const results = await repository.search(buildFilterQuery(query), query);

        expect(Array.isArray(results)).toBe(true);
      },
    );
  });

  describe('facets', () => {
    itWithData(
      'counts each dimension over the filtered set',
      hasVehicles,
      async () => {
        const facets = await repository.facets(dto());

        expect(Object.keys(facets).sort()).toEqual([
          'condition',
          'fuelType',
          'make',
          'transmissionType',
          'vehicleType',
        ]);

        for (const bucket of facets.make) {
          expect(bucket.count).toBeGreaterThan(0);
        }
      },
    );

    // A dimension drops its own filter before counting, so the other options
    // stay visible and selectable in the UI.
    itWithData(
      'keeps sibling options visible for the faceted field',
      hasVehicles,
      async () => {
        const { make } = await queryRow<{ make: string }>(
          ds,
          `SELECT make FROM marketplace.vehicles WHERE status = 'LIVE' GROUP BY make
          ORDER BY COUNT(*) DESC LIMIT 1`,
        );

        const facets = await repository.facets(dto({ make: [make] }));

        // Filtering by one make must not reduce the make facet to that one.
        expect(facets.make.length).toBeGreaterThan(1);
      },
    );

    itWithData(
      'narrows other dimensions by the applied filter',
      hasVehicles,
      async () => {
        const { make } = await queryRow<{ make: string }>(
          ds,
          `SELECT make FROM marketplace.vehicles WHERE status = 'LIVE' GROUP BY make
          ORDER BY COUNT(*) DESC LIMIT 1`,
        );

        const [unfiltered, filtered] = await Promise.all([
          repository.facets(dto()),
          repository.facets(dto({ make: [make] })),
        ]);

        const total = (buckets: { count: number }[]) =>
          buckets.reduce((sum, b) => sum + b.count, 0);

        expect(total(filtered.fuelType)).toBeLessThanOrEqual(
          total(unfiltered.fuelType),
        );
      },
    );
  });

  describe('vehicle detail', () => {
    itWithData(
      'returns a LIVE listing with its dealer and images',
      hasVehicles,
      async () => {
        const { id } = await queryRow<{ id: string }>(
          ds,
          `SELECT id FROM marketplace.vehicles WHERE status = 'LIVE' LIMIT 1`,
        );

        const detail = await repository.findById(id);

        expect(detail).not.toBeNull();
        expect(detail!.id).toBe(id);
        expect(detail!.dealer).toBeDefined();
        expect(Array.isArray(detail!.images)).toBe(true);
      },
    );

    // The array_agg subquery returns NULL, not an empty array, for a vehicle
    // with no images — the COALESCE in the mapper is load-bearing.
    itWithData(
      'returns an empty image list rather than null',
      hasVehicles,
      async () => {
        const rows = await queryRows<{ id: string }>(
          ds,
          `SELECT v.id FROM marketplace.vehicles v
          WHERE v.status = 'LIVE'
            AND NOT EXISTS (SELECT 1 FROM marketplace.vehicle_images i WHERE i.vehicle_id = v.id)
          LIMIT 1`,
        );

        if (rows.length === 0) {
          console.warn('[skipped: every seeded vehicle has images]');
          return;
        }

        const detail = await repository.findById(rows[0].id);

        expect(detail!.images).toEqual([]);
      },
    );

    // A non-LIVE listing must not be reachable by direct id — the status
    // predicate is the only thing hiding a DRAFT from the public.
    itWithData('hides a listing that is not LIVE', hasVehicles, async () => {
      const rows = await queryRows<{ id: string }>(
        ds,
        `SELECT id FROM marketplace.vehicles WHERE status <> 'LIVE' LIMIT 1`,
      );

      if (rows.length === 0) {
        console.warn('[skipped: every seeded vehicle is LIVE]');
        return;
      }

      await expect(repository.findById(rows[0].id)).resolves.toBeNull();
    });

    it('returns null for an id that does not exist', async () => {
      await expect(
        repository.findById('00000000-0000-4000-8000-000000000000'),
      ).resolves.toBeNull();
    });
  });
});
