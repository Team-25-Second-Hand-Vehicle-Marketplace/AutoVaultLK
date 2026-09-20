import { DataSource } from 'typeorm';
import {
  connect,
  describeWithDatabase,
  disconnect,
  fakeEmbedding,
  queryRow,
  queryRows,
} from './test-database';

/**
 * Writing and reading back the search index columns (FR-13.1 / FR-13.2).
 *
 * ListingSearchIndexService produces a `[0.1,0.2,...]` string for a `vector`
 * column. Whether Postgres accepts that string, stores 384 dimensions, and
 * still ranks it afterwards is not something a mocked repository can answer:
 * a malformed literal or a dimension mismatch raises only on the real INSERT.
 *
 * The embedder itself is not exercised here — loading the ~90MB MiniLM ONNX
 * model would make the suite slow and dependent on a model download. What
 * matters for the SQL is the *shape* of the value it emits, so these use a
 * synthetic vector of the same dimensionality. The embedder's own behaviour is
 * covered by test/unit/listings/services/listing-search-index.service.spec.ts.
 */
describeWithDatabase('listing search index (integration)', () => {
  let ds: DataSource;
  let dealerId: string | null = null;
  const created: string[] = [];

  beforeAll(async () => {
    const connection = await connect();
    if (!connection)
      throw new Error('Database became unreachable after the probe');
    ds = connection;

    const dealers = await queryRows<{ id: string }>(
      ds,
      `SELECT id FROM auth.users WHERE role = 'DEALER' AND is_active = true LIMIT 1`,
    );
    dealerId = dealers[0]?.id ?? null;
  });

  afterAll(async () => {
    if (created.length > 0) {
      await ds.query(`DELETE FROM marketplace.vehicles WHERE id = ANY($1)`, [
        created,
      ]);
    }
    await disconnect();
  });

  /** Inserts a listing the way ListingRepository does, and tracks it for cleanup. */
  async function insertListing(fields: {
    searchText: string | null;
    embedding: string | null;
    make?: string;
    model?: string;
  }): Promise<string> {
    const inserted = await queryRow<{ id: string }>(
      ds,
      `INSERT INTO marketplace.vehicles
         (dealer_id, vehicle_type, make, model, condition, manufacture_year,
          price, mileage, status, specs, search_text, embedding)
       VALUES ($1, 'CAR', $2, $3, 'USED', 2018, 4500000, 60000, 'LIVE', '{}'::jsonb, $4, $5::vector)
       RETURNING id`,
      [
        dealerId,
        fields.make ?? 'Toyota',
        fields.model ?? 'IntegrationTestModel',
        fields.searchText,
        fields.embedding,
      ],
    );

    created.push(inserted.id);
    return inserted.id;
  }

  const hasDealer = () => dealerId !== null;

  function guard(name: string, body: () => Promise<void>) {
    it(name, async () => {
      if (!hasDealer()) {
        console.warn(`[skipped: no DEALER user seeded] ${name}`);
        return;
      }
      await body();
    });
  }

  describe('writing the index columns', () => {
    // The literal toPgVector produces must be one Postgres accepts.
    guard('accepts the pgvector literal the shared library emits', async () => {
      const id = await insertListing({
        searchText: 'toyota vitz 2018 petrol automatic',
        embedding: `[${fakeEmbedding(2).join(',')}]`,
      });

      const stored = await queryRow<{
        search_text: string;
        has_embedding: boolean;
      }>(
        ds,
        `SELECT search_text, embedding IS NOT NULL AS has_embedding
           FROM marketplace.vehicles WHERE id = $1`,
        [id],
      );

      expect(stored.search_text).toBe('toyota vitz 2018 petrol automatic');
      expect(stored.has_embedding).toBe(true);
    });

    // FR-22.1's dimension contract, enforced by the column type itself.
    guard('rejects an embedding of the wrong dimensionality', async () => {
      await expect(
        ds.query(
          `INSERT INTO marketplace.vehicles
             (dealer_id, vehicle_type, make, model, condition, manufacture_year,
              price, mileage, status, specs, embedding)
           VALUES ($1, 'CAR', 'Toyota', 'BadVector', 'USED', 2018, 1, 1, 'DRAFT', '{}'::jsonb, $2::vector)`,
          [dealerId, '[0.1,0.2,0.3]'],
        ),
      ).rejects.toThrow();
    });

    // The service returns null for both when search_text would be empty; the
    // columns must be nullable for that to be storable at all.
    guard('stores a listing with no embedding', async () => {
      const id = await insertListing({ searchText: null, embedding: null });

      const stored = await queryRow<{
        search_text: string | null;
        embedding: string | null;
      }>(
        ds,
        `SELECT search_text, embedding FROM marketplace.vehicles WHERE id = $1`,
        [id],
      );

      expect(stored.search_text).toBeNull();
      expect(stored.embedding).toBeNull();
    });
  });

  describe('regenerating on edit (FR-13.1, FR-13.2)', () => {
    // The defect FR-13.2 describes: an edited listing still described by its
    // old vector is findable only by the terms it no longer contains.
    guard(
      'replaces the stored vector rather than leaving the old one',
      async () => {
        const original = fakeEmbedding(2);
        const id = await insertListing({
          searchText: 'toyota vitz hatchback',
          embedding: `[${original.join(',')}]`,
        });

        const replacement = fakeEmbedding(9);
        await ds.query(
          `UPDATE marketplace.vehicles
            SET search_text = $2, embedding = $3::vector
          WHERE id = $1`,
          [id, 'nissan leaf electric', `[${replacement.join(',')}]`],
        );

        const stored = await queryRow<{
          search_text: string;
          distance_to_new: number;
          distance_to_old: number;
        }>(
          ds,
          `SELECT search_text,
                embedding <=> $2::vector AS distance_to_new,
                embedding <=> $3::vector AS distance_to_old
           FROM marketplace.vehicles WHERE id = $1`,
          [id, `[${replacement.join(',')}]`, `[${original.join(',')}]`],
        );

        expect(stored.search_text).toBe('nissan leaf electric');
        // Distance 0 to the new vector proves the column now holds it; a larger
        // distance to the old one proves the old vector is gone.
        expect(Number(stored.distance_to_new)).toBeCloseTo(0, 5);
        expect(Number(stored.distance_to_old)).toBeGreaterThan(
          Number(stored.distance_to_new),
        );
      },
    );

    guard('makes the edited listing findable by its new terms', async () => {
      const id = await insertListing({
        searchText: 'toyota vitz hatchback',
        embedding: `[${fakeEmbedding(2).join(',')}]`,
      });

      await ds.query(
        `UPDATE marketplace.vehicles SET search_text = $2 WHERE id = $1`,
        [id, 'nissan leaf electric hatchback'],
      );

      // pg_trgm over search_text is the fallback path a buyer's query takes
      // when no embedding is available.
      const stored = await queryRow<{ similarity: number }>(
        ds,
        `SELECT word_similarity('nissan leaf', COALESCE(search_text, '')) AS similarity
           FROM marketplace.vehicles WHERE id = $1`,
        [id],
      );

      expect(Number(stored.similarity)).toBeGreaterThan(0.5);
    });

    guard('no longer matches the terms it used to contain', async () => {
      const id = await insertListing({
        searchText: 'toyota vitz hatchback',
        embedding: null,
      });

      await ds.query(
        `UPDATE marketplace.vehicles SET search_text = $2 WHERE id = $1`,
        [id, 'nissan leaf electric'],
      );

      const stored = await queryRow<{ similarity: number }>(
        ds,
        `SELECT word_similarity('toyota vitz', COALESCE(search_text, '')) AS similarity
           FROM marketplace.vehicles WHERE id = $1`,
        [id],
      );

      expect(Number(stored.similarity)).toBeLessThan(0.5);
    });
  });

  describe('ranking a freshly written vector', () => {
    // End to end for the write path: a vector written through the insert above
    // must be rankable by the same `<=>` the search repository uses.
    guard('ranks the new listing first for its own embedding', async () => {
      const embedding = fakeEmbedding(11);
      const id = await insertListing({
        searchText: 'integration ranking probe',
        embedding: `[${embedding.join(',')}]`,
      });

      const nearest = await queryRows<{ id: string }>(
        ds,
        `SELECT id FROM marketplace.vehicles
          WHERE status = 'LIVE' AND embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector ASC
          LIMIT 1`,
        [`[${embedding.join(',')}]`],
      );

      expect(nearest[0].id).toBe(id);
    });
  });
});
