import type { DataSource } from 'typeorm';
import { MarketplaceVehiclesWriteAdapter } from '../../src/workers/etl-worker/pipeline/persistence/marketplace-vehicles-write.adapter';
import type {
  EmbeddedRow,
  VehicleFields,
} from '../../src/workers/etl-worker/pipeline/types';
import {
  cleanup,
  connect,
  createJob,
  describeWithDatabase,
  disconnect,
  findDealer,
} from './test-database';

const VALID: VehicleFields = {
  vehicleType: 'CAR',
  make: 'Toyota',
  model: 'Vitz',
  condition: 'USED',
  manufactureYear: 2015,
  price: 3_500_000,
  mileage: 45_000,
  fuelType: 'PETROL',
  transmissionType: 'AUTOMATIC',
  locationCity: 'Nugegoda',
  locationDistrict: 'Colombo',
  specs: { body_type: 'HATCHBACK' },
};

/** 384 floats — the MiniLM dimension pgvector's column is declared with. */
const VECTOR = `[${Array.from({ length: 384 }, () => 0.1).join(',')}]`;

const row = (overrides: Partial<VehicleFields> = {}, rowNumber = 1): EmbeddedRow => ({
  rowNumber,
  raw: {},
  normalized: { ...VALID, ...overrides },
  confidence: 1,
  searchText: 'Toyota Vitz 2015 CAR PETROL AUTOMATIC Nugegoda Colombo HATCHBACK',
  embedding: VECTOR,
});

/** Unique per run so a crashed test cannot collide with the next one. */
const plate = (n: number): string => `IT${String(Date.now()).slice(-6)}-${n}`;

describeWithDatabase('MarketplaceVehiclesWriteAdapter (integration)', () => {
  let ds: DataSource;
  let adapter: MarketplaceVehiclesWriteAdapter;
  let dealerId: string;
  const jobs: string[] = [];

  const newJob = async (): Promise<string> => {
    const id = await createJob(ds, dealerId);
    jobs.push(id);
    return id;
  };

  beforeAll(async () => {
    const connected = await connect();
    if (!connected) throw new Error('Database unreachable despite the reachability probe');
    ds = connected;
    adapter = new MarketplaceVehiclesWriteAdapter(ds);
    dealerId = await findDealer(ds);
  });

  afterAll(async () => {
    await cleanup(jobs);
    await disconnect();
  });

  describe('the statement Postgres actually accepts', () => {
    it('inserts a row with every column populated', async () => {
      // The unit tests assert on the SQL string. This asserts the database
      // accepts it: column count, types, the ::jsonb and ::vector casts, and
      // the CHECK constraints on vehicle_type, condition, fuel_type and status.
      const jobId = await newJob();

      const result = await adapter.upsertBatch(jobId, dealerId, [
        row({ registrationNumber: plate(1) }),
      ]);

      expect(result.loaded).toHaveLength(1);
      expect(result.rejections).toEqual([]);

      const [stored] = (await ds.query(
        `SELECT make, model, vehicle_type, condition, status, price, mileage,
                specs->>'body_type' AS body_type, search_text, dealer_id
           FROM marketplace.vehicles WHERE id = $1`,
        [result.loaded[0].id],
      )) as Record<string, unknown>[];

      expect(stored).toMatchObject({
        make: 'Toyota',
        model: 'Vitz',
        vehicle_type: 'CAR',
        condition: 'USED',
        status: 'PENDING_REVIEW',
        body_type: 'HATCHBACK',
        dealer_id: dealerId,
      });
    });

    it('stores the embedding as a real 384-dimension vector', async () => {
      // pgvector rejects a bare parameter as an unknown type, and a wrong
      // dimension is a hard error the column declaration enforces.
      const jobId = await newJob();

      const result = await adapter.upsertBatch(jobId, dealerId, [
        row({ registrationNumber: plate(2) }),
      ]);

      const [stored] = (await ds.query(
        `SELECT vector_dims(embedding) AS dims FROM marketplace.vehicles WHERE id = $1`,
        [result.loaded[0].id],
      )) as { dims: number }[];

      expect(stored.dims).toBe(384);
    });

    it('lets the trigger fill search_vector from search_text', async () => {
      // trg_vehicles_search_vector runs BEFORE INSERT OR UPDATE OF search_text.
      // The adapter never writes the column; if it did, or if the trigger were
      // dropped, this is what would notice.
      const jobId = await newJob();

      const result = await adapter.upsertBatch(jobId, dealerId, [
        row({ registrationNumber: plate(3) }),
      ]);

      const [stored] = (await ds.query(
        `SELECT search_vector IS NOT NULL AS has_vector,
                search_vector @@ to_tsquery('english', 'toyota') AS matches
           FROM marketplace.vehicles WHERE id = $1`,
        [result.loaded[0].id],
      )) as { has_vector: boolean; matches: boolean }[];

      expect(stored.has_vector).toBe(true);
      expect(stored.matches).toBe(true);
    });

    it('inserts a whole batch in one statement', async () => {
      const jobId = await newJob();

      const result = await adapter.upsertBatch(
        jobId,
        dealerId,
        [1, 2, 3, 4, 5].map((n) => row({ registrationNumber: plate(10 + n) }, n)),
      );

      expect(result.loaded).toHaveLength(5);
      expect(await countFor(ds, jobId)).toBe(5);
    });

    it('accepts a row with a null registration number', async () => {
      // Unregistered imports miss both partial indexes entirely.
      const jobId = await newJob();

      const result = await adapter.upsertBatch(jobId, dealerId, [row({}, 1)]);

      expect(result.loaded).toHaveLength(1);
      expect(result.loaded[0].registration_number).toBeNull();
    });
  });

  describe('the ON CONFLICT target', () => {
    it('matches the partial index and updates in place', async () => {
      // idx_vehicles_job_registration is partial. If the conflict target's
      // WHERE clause does not match the index predicate exactly, Postgres
      // raises "no unique or exclusion constraint matching" — a failure no
      // string assertion can catch.
      const jobId = await newJob();
      const registration = plate(20);

      const first = await adapter.upsertBatch(jobId, dealerId, [
        row({ registrationNumber: registration, price: 3_500_000 }),
      ]);

      const second = await adapter.upsertBatch(jobId, dealerId, [
        row({ registrationNumber: registration, price: 2_900_000 }),
      ]);

      // Same row, updated — not a second insert.
      expect(second.loaded[0].id).toBe(first.loaded[0].id);
      expect(await countFor(ds, jobId)).toBe(1);

      const [stored] = (await ds.query(
        `SELECT price::float8 AS price FROM marketplace.vehicles WHERE id = $1`,
        [first.loaded[0].id],
      )) as { price: number }[];

      // DO UPDATE, not DO NOTHING: a dealer re-uploading a corrected file
      // expects the correction to land.
      expect(stored.price).toBe(2_900_000);
    });

    it('bumps updated_at on the upsert path', async () => {
      // ON CONFLICT bypasses TypeORM's @UpdateDateColumn, so the adapter sets
      // it explicitly. Without that the row would look untouched.
      const jobId = await newJob();
      const registration = plate(21);

      const first = await adapter.upsertBatch(jobId, dealerId, [
        row({ registrationNumber: registration }),
      ]);

      const before = await updatedAt(ds, first.loaded[0].id);
      await new Promise((r) => setTimeout(r, 10));

      await adapter.upsertBatch(jobId, dealerId, [
        row({ registrationNumber: registration, price: 1_000_000 }),
      ]);

      expect((await updatedAt(ds, first.loaded[0].id)).getTime()).toBeGreaterThan(
        before.getTime(),
      );
    });
  });

  describe('cross-job duplicate registration', () => {
    it('rejects the row and keeps the rest of the batch', async () => {
      // The GLOBAL unique from migration 6000, which the composite target
      // structurally cannot catch because the job ids differ. A batch INSERT
      // aborts entirely, so without per-row isolation the good rows are lost.
      const firstJob = await newJob();
      const duplicate = plate(30);

      await adapter.upsertBatch(firstJob, dealerId, [row({ registrationNumber: duplicate })]);

      const secondJob = await newJob();
      const result = await adapter.upsertBatch(secondJob, dealerId, [
        row({ registrationNumber: plate(31) }, 1),
        row({ registrationNumber: duplicate }, 2),
        row({ registrationNumber: plate(32) }, 3),
      ]);

      expect(result.loaded).toHaveLength(2);
      expect(result.rejections).toHaveLength(1);
      expect(result.rejections[0].rowNumber).toBe(2);
      expect(result.rejections[0].reason).toMatch(/already listed/);
    });

    it('names the registration number in the reason', async () => {
      const firstJob = await newJob();
      const duplicate = plate(40);
      await adapter.upsertBatch(firstJob, dealerId, [row({ registrationNumber: duplicate })]);

      const secondJob = await newJob();
      const result = await adapter.upsertBatch(secondJob, dealerId, [
        row({ registrationNumber: duplicate }),
      ]);

      expect(result.rejections[0].reason).toContain(duplicate);
    });
  });

  describe('the ADR-002 grant boundary', () => {
    it('cannot DELETE from marketplace.vehicles', async () => {
      // The architectural claim, asserted against the database rather than the
      // source. If this ever succeeds, the grant has been widened and ETL can
      // destroy a dealer's manually created listings.
      await expect(
        ds.query(`DELETE FROM marketplace.vehicles WHERE id = gen_random_uuid()`),
      ).rejects.toThrow(/permission denied/i);
    });

    it('holds exactly SELECT, INSERT and UPDATE', async () => {
      const [grants] = (await ds.query(
        `SELECT has_table_privilege('marketplace.vehicles', 'SELECT') AS can_select,
                has_table_privilege('marketplace.vehicles', 'INSERT') AS can_insert,
                has_table_privilege('marketplace.vehicles', 'UPDATE') AS can_update,
                has_table_privilege('marketplace.vehicles', 'DELETE') AS can_delete,
                has_table_privilege('marketplace.vehicles', 'TRUNCATE') AS can_truncate`,
      )) as Record<string, boolean>[];

      expect(grants).toEqual({
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: false,
        can_truncate: false,
      });
    });
  });

  it('counts only its own job', async () => {
    const jobId = await newJob();
    await adapter.upsertBatch(jobId, dealerId, [
      row({ registrationNumber: plate(50) }, 1),
      row({ registrationNumber: plate(51) }, 2),
    ]);

    expect(await adapter.countForJob(jobId)).toBe(2);
    expect(await adapter.countForJob(await newJob())).toBe(0);
  });
});

async function countFor(ds: DataSource, jobId: string): Promise<number> {
  const [r] = (await ds.query(
    `SELECT count(*)::int AS count FROM marketplace.vehicles WHERE upload_job_id = $1`,
    [jobId],
  )) as { count: number }[];
  return r.count;
}

async function updatedAt(ds: DataSource, id: string): Promise<Date> {
  const [r] = (await ds.query(`SELECT updated_at FROM marketplace.vehicles WHERE id = $1`, [
    id,
  ])) as { updated_at: Date }[];
  return r.updated_at;
}
