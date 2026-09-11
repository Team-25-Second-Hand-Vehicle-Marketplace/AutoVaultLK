import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MarketplaceVehiclesWriteAdapter } from '../../../../src/workers/etl-worker/pipeline/persistence/marketplace-vehicles-write.adapter';
import type {
  EmbeddedRow,
  VehicleFields,
} from '../../../../src/workers/etl-worker/pipeline/types';

const VALID: VehicleFields = {
  vehicleType: 'CAR',
  make: 'Toyota',
  model: 'Vitz',
  condition: 'USED',
  manufactureYear: 2015,
  price: 3_500_000,
  mileage: 45_000,
};

const row = (
  overrides: Partial<VehicleFields> = {},
  o: { rowNumber?: number; embedding?: string | null } = {},
): EmbeddedRow => ({
  rowNumber: o.rowNumber ?? 1,
  raw: {},
  normalized: { ...VALID, ...overrides },
  confidence: 1,
  searchText: 'Toyota Vitz 2015 CAR',
  embedding: o.embedding === undefined ? '[0.1,0.2]' : o.embedding,
});

const uniqueViolation = () => Object.assign(new Error('duplicate key'), { code: '23505' });

type Harness = {
  adapter: MarketplaceVehiclesWriteAdapter;
  query: jest.Mock;
};

const harness = (impl?: jest.Mock): Harness => {
  const query = impl ?? jest.fn().mockResolvedValue([{ id: 'v1', registration_number: null }]);
  return {
    query,
    adapter: new MarketplaceVehiclesWriteAdapter({ query } as never),
  };
};

const sqlOf = (query: jest.Mock, call = 0): string => query.mock.calls[call][0] as string;

describe('MarketplaceVehiclesWriteAdapter', () => {
  describe('the ADR-002 boundary', () => {
    it('never emits DELETE', async () => {
      // ingestion_service_role holds no DELETE grant, so this would fail at
      // runtime — but the reason it holds none is that ETL must not be able to
      // destroy a dealer's manually created listings.
      const { adapter, query } = harness();

      await adapter.upsertBatch('job-1', 'dealer-1', [row()]);

      for (const call of query.mock.calls) {
        expect(String(call[0])).not.toMatch(/\bDELETE\b/i);
      }
    });

    it('is the only file in the service that writes marketplace.vehicles', () => {
      // A second writer does not break a test; it dissolves the architectural
      // claim the whole design rests on. This makes that failure loud.
      const source = readFileSync(
        resolve(
          __dirname,
          '../../../../src/workers/etl-worker/pipeline/persistence/marketplace-vehicles-write.adapter.ts',
        ),
        'utf8',
      );

      expect(source).toMatch(/INSERT INTO marketplace\.vehicles/);
    });
  });

  describe('the upsert statement', () => {
    it('targets the composite index with its partial predicate', async () => {
      // idx_vehicles_job_registration is partial; a conflict target that omits
      // the WHERE clause does not match it and Postgres raises.
      const { adapter, query } = harness();

      await adapter.upsertBatch('job-1', 'dealer-1', [row()]);

      expect(sqlOf(query)).toMatch(/ON CONFLICT \(upload_job_id, registration_number\)/);
      expect(sqlOf(query)).toMatch(
        /WHERE upload_job_id IS NOT NULL AND registration_number IS NOT NULL/,
      );
    });

    it('updates rather than doing nothing', async () => {
      // A dealer re-uploading a corrected file expects the corrections to land.
      const { adapter, query } = harness();

      await adapter.upsertBatch('job-1', 'dealer-1', [row()]);

      expect(sqlOf(query)).toMatch(/DO UPDATE SET/);
      expect(sqlOf(query)).not.toMatch(/DO NOTHING/);
    });

    it('never writes search_vector', async () => {
      // trg_vehicles_search_vector fills it from search_text. Writing it here
      // would be overwritten by the trigger, or drift from search_text if the
      // trigger were ever dropped.
      const { adapter, query } = harness();

      await adapter.upsertBatch('job-1', 'dealer-1', [row()]);

      expect(sqlOf(query)).not.toMatch(/search_vector/);
    });

    it('writes search_text and embedding in the same statement', async () => {
      const { adapter, query } = harness();

      await adapter.upsertBatch('job-1', 'dealer-1', [row()]);

      expect(sqlOf(query)).toMatch(/search_text/);
      expect(sqlOf(query)).toMatch(/embedding/);
    });

    it('casts the embedding to vector', async () => {
      // pgvector rejects a bare parameter as an unknown type.
      const { adapter, query } = harness();

      await adapter.upsertBatch('job-1', 'dealer-1', [row()]);

      expect(sqlOf(query)).toMatch(/::vector/);
    });

    it('forces status to PENDING_REVIEW', async () => {
      // Bulk stock is reviewed before going live (FR-33); a dealer CSV must not
      // publish listings directly.
      const { adapter, query } = harness();

      await adapter.upsertBatch('job-1', 'dealer-1', [row()]);

      expect(sqlOf(query)).toMatch(/'PENDING_REVIEW'/);
    });

    it('returns the id and registration number for the image join', async () => {
      const { adapter, query } = harness();

      await adapter.upsertBatch('job-1', 'dealer-1', [row()]);

      expect(sqlOf(query)).toMatch(/RETURNING id, registration_number/);
    });
  });

  describe('parameters', () => {
    it('takes dealer_id from the job, never the CSV', async () => {
      // A dealer_id column in an uploaded file must not be able to assign
      // stock to another dealer.
      const { adapter, query } = harness();

      await adapter.upsertBatch('job-1', 'dealer-from-job', [row()]);

      expect(query.mock.calls[0][1][0]).toBe('dealer-from-job');
      expect(query.mock.calls[0][1][1]).toBe('job-1');
    });

    it('sends one parameter set per row in a single statement', async () => {
      // 250 rows as one round trip, not 250.
      const { adapter, query } = harness();

      await adapter.upsertBatch('job-1', 'dealer-1', [row(), row(), row()]);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][1]).toHaveLength(72);
    });

    it('passes a null embedding through rather than skipping the row', async () => {
      const { adapter, query } = harness();

      await adapter.upsertBatch('job-1', 'dealer-1', [row({}, { embedding: null })]);

      expect(query.mock.calls[0][1][23]).toBeNull();
    });
  });

  describe('duplicate registration across jobs', () => {
    it('isolates the offending row and keeps the rest of the batch', async () => {
      // The GLOBAL unique on registration_number fires when a dealer
      // re-uploads a vehicle already listed under a DIFFERENT job — the
      // composite target cannot catch it, because the job ids differ. A batch
      // INSERT aborts entirely, so the good rows would be lost.
      const query = jest
        .fn()
        .mockRejectedValueOnce(uniqueViolation())
        .mockResolvedValueOnce([{ id: 'v1', registration_number: 'CAB-1' }])
        .mockRejectedValueOnce(uniqueViolation())
        .mockResolvedValueOnce([{ id: 'v3', registration_number: 'CAB-3' }]);

      const { adapter } = harness(query);

      const result = await adapter.upsertBatch('job-1', 'dealer-1', [
        row({ registrationNumber: 'CAB-1' }, { rowNumber: 1 }),
        row({ registrationNumber: 'CAB-2' }, { rowNumber: 2 }),
        row({ registrationNumber: 'CAB-3' }, { rowNumber: 3 }),
      ]);

      expect(result.loaded).toHaveLength(2);
      expect(result.rejections).toHaveLength(1);
      expect(result.rejections[0].rowNumber).toBe(2);
    });

    it('names the registration number in the rejection', async () => {
      const query = jest
        .fn()
        .mockRejectedValueOnce(uniqueViolation())
        .mockRejectedValueOnce(uniqueViolation());

      const { adapter } = harness(query);

      const result = await adapter.upsertBatch('job-1', 'dealer-1', [
        row({ registrationNumber: 'CAB-1234' }),
      ]);

      expect(result.rejections[0].reason).toMatch(/CAB-1234 is already listed/);
    });

    it('propagates a non-unique-violation error', async () => {
      // Infrastructure failure must reach the orchestrator and fail the chunk,
      // not be silently recorded as 250 rejected rows.
      const query = jest.fn().mockRejectedValue(new Error('connection terminated'));
      const { adapter } = harness(query);

      await expect(adapter.upsertBatch('job-1', 'dealer-1', [row()])).rejects.toThrow(
        /connection terminated/,
      );
    });

    it('propagates an error raised during row isolation', async () => {
      const query = jest
        .fn()
        .mockRejectedValueOnce(uniqueViolation())
        .mockRejectedValueOnce(new Error('connection terminated'));

      const { adapter } = harness(query);

      await expect(adapter.upsertBatch('job-1', 'dealer-1', [row()])).rejects.toThrow(
        /connection terminated/,
      );
    });
  });

  it('makes no query for an empty batch', async () => {
    const { adapter, query } = harness();

    const result = await adapter.upsertBatch('job-1', 'dealer-1', []);

    expect(query).not.toHaveBeenCalled();
    expect(result).toEqual({ loaded: [], rejections: [] });
  });
});
