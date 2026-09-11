import { MarketplaceVehicleImagesWriteAdapter } from '../../../../src/workers/etl-worker/pipeline/persistence/marketplace-vehicle-images-write.adapter';

const harness = (impl?: jest.Mock) => {
  const query = impl ?? jest.fn().mockResolvedValue([]);
  return { query, adapter: new MarketplaceVehicleImagesWriteAdapter({ query } as never) };
};

const sqlOf = (query: jest.Mock, call = 0): string => query.mock.calls[call][0] as string;
const paramsOf = (query: jest.Mock, call = 0): unknown[] => query.mock.calls[call][1] as unknown[];

const image = (n: number) => ({ s3Path: `images/job-1/CAB-1/${n}.jpg` });

describe('MarketplaceVehicleImagesWriteAdapter', () => {
  describe('the ADR-002 boundary', () => {
    it('never emits DELETE', async () => {
      // ingestion_service_role holds no DELETE grant on vehicle_images either.
      // The reason it holds none is that ETL must not be able to destroy a
      // dealer's manually uploaded photos.
      const { adapter, query } = harness();

      await adapter.insertForVehicle('v-1', [image(1)]);
      await adapter.vehicleIdsByRegistration('job-1');
      await adapter.countForJob('job-1');

      for (const call of query.mock.calls) {
        expect(String(call[0])).not.toMatch(/\bDELETE\b/i);
      }
    });
  });

  describe('the single-primary invariant', () => {
    it('marks exactly one image primary', async () => {
      // idx_vehicle_images_one_primary is a partial unique index on
      // (vehicle_id) WHERE is_primary. A second true raises 23505 and takes
      // the whole statement with it, so the caller is not trusted to get this
      // right — primaryIndex names the winner and every other row is forced
      // false.
      const { adapter, query } = harness();

      await adapter.insertForVehicle('v-1', [image(1), image(2), image(3)]);

      const params = paramsOf(query);
      // is_primary is the 5th parameter of each 6-column tuple.
      expect([params[4], params[10], params[16]]).toEqual([true, false, false]);
    });

    it('honours an explicit primaryIndex', async () => {
      const { adapter, query } = harness();

      await adapter.insertForVehicle('v-1', [image(1), image(2), image(3)], 1);

      const params = paramsOf(query);
      expect([params[4], params[10], params[16]]).toEqual([false, true, false]);
    });

    it('marks none primary when the index is out of range', async () => {
      // Better than silently promoting image 0: a caller passing a bad index
      // has a bug, and a vehicle with no primary is recoverable where a wrong
      // primary is invisible.
      const { adapter, query } = harness();

      await adapter.insertForVehicle('v-1', [image(1), image(2)], 5);

      const params = paramsOf(query);
      expect([params[4], params[10]]).toEqual([false, false]);
    });
  });

  describe('idempotency', () => {
    it('upserts on (vehicle_id, s3_path)', async () => {
      // ASL retries a failed state by re-invoking it. Without this the same
      // source file inserts twice and the dealer sees one photo listed twice.
      const { adapter, query } = harness();

      await adapter.insertForVehicle('v-1', [image(1)]);

      expect(sqlOf(query)).toMatch(/ON CONFLICT \(vehicle_id, s3_path\)/);
      expect(sqlOf(query)).toMatch(/DO UPDATE SET/);
    });

    it('refreshes the processed paths on a re-run', async () => {
      const { adapter, query } = harness();

      await adapter.insertForVehicle('v-1', [image(1)]);

      expect(sqlOf(query)).toMatch(/processed_path = EXCLUDED\.processed_path/);
      expect(sqlOf(query)).toMatch(/thumbnail_path = EXCLUDED\.thumbnail_path/);
    });
  });

  describe('insertForVehicle', () => {
    it('sends one statement for the whole batch', async () => {
      const { adapter, query } = harness();

      await adapter.insertForVehicle('v-1', [image(1), image(2), image(3)]);

      expect(query).toHaveBeenCalledTimes(1);
      expect(paramsOf(query)).toHaveLength(18);
    });

    it('defaults display order to the array position', async () => {
      const { adapter, query } = harness();

      await adapter.insertForVehicle('v-1', [image(1), image(2)]);

      const params = paramsOf(query);
      expect([params[5], params[11]]).toEqual([0, 1]);
    });

    it('honours an explicit display order', async () => {
      const { adapter, query } = harness();

      await adapter.insertForVehicle('v-1', [{ ...image(1), displayOrder: 7 }]);

      expect(paramsOf(query)[5]).toBe(7);
    });

    it('nulls the processed paths when they are absent', async () => {
      // B3 may insert originals first and fill the derived paths later.
      const { adapter, query } = harness();

      await adapter.insertForVehicle('v-1', [image(1)]);

      expect(paramsOf(query).slice(2, 4)).toEqual([null, null]);
    });

    it('makes no query for an empty batch', async () => {
      const { adapter, query } = harness();

      await expect(adapter.insertForVehicle('v-1', [])).resolves.toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });

    it('returns the ids so the caller can report what landed', async () => {
      const rows = [{ id: 'i-1', vehicle_id: 'v-1', is_primary: true }];
      const { adapter } = harness(jest.fn().mockResolvedValue(rows));

      await expect(adapter.insertForVehicle('v-1', [image(1)])).resolves.toEqual(rows);
    });
  });

  describe('vehicleIdsByRegistration', () => {
    it('scopes the lookup to one job', async () => {
      // A dealer's upload must not attach images to another dealer's stock
      // that happens to share a plate.
      const { adapter, query } = harness();

      await adapter.vehicleIdsByRegistration('job-1');

      expect(sqlOf(query)).toMatch(/WHERE upload_job_id = \$1/);
      expect(paramsOf(query)).toEqual(['job-1']);
    });

    it('skips vehicles with no registration number', async () => {
      // Unregistered imports cannot be matched by filename, so offering them
      // would only produce false matches.
      const { adapter, query } = harness();

      await adapter.vehicleIdsByRegistration('job-1');

      expect(sqlOf(query)).toMatch(/registration_number IS NOT NULL/);
    });

    it('keys the map by registration number', async () => {
      const { adapter } = harness(
        jest.fn().mockResolvedValue([
          { id: 'v-1', registration_number: 'CAB-1234' },
          { id: 'v-2', registration_number: 'CAB-5678' },
        ]),
      );

      const map = await adapter.vehicleIdsByRegistration('job-1');

      expect(map.get('CAB-1234')).toBe('v-1');
      expect(map.size).toBe(2);
    });
  });

  describe('countForJob', () => {
    it('joins through vehicles, since images carry no job id', async () => {
      const { adapter, query } = harness(jest.fn().mockResolvedValue([{ count: 12 }]));

      await expect(adapter.countForJob('job-1')).resolves.toBe(12);
      expect(sqlOf(query)).toMatch(/JOIN marketplace\.vehicles/);
    });

    it('returns 0 when the job has landed no images', async () => {
      const { adapter } = harness(jest.fn().mockResolvedValue([]));

      await expect(adapter.countForJob('job-1')).resolves.toBe(0);
    });
  });
});
