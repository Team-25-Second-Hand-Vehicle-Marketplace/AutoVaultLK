import { Readable } from 'node:stream';
import { LocalOrchestrator } from '../../../src/workers/etl-worker/local-orchestrator';
import { InMemoryDictionarySnapshot } from '../../../src/workers/etl-worker/pipeline/normalize/dictionary-snapshot';
import { __setEmbedder } from '../../../src/workers/etl-worker/pipeline/embed/embed.stage';
import type { DictionaryRow } from '../../../src/workers/etl-worker/pipeline/normalize/dictionary-snapshot';

const HEADER = 'registration_number,make,model,year,price,mileage';
const ROW = (n: number) => `CAB-${n},Toyota,Vitz,2015,3500000,45000`;

const DICTIONARY = new InMemoryDictionarySnapshot([
  {
    id: 'mk-toyota',
    parentId: null,
    dictionaryType: 'MAKE',
    canonicalValue: 'Toyota',
    aliases: [],
    vehicleTypes: ['CAR'],
  } as DictionaryRow,
  {
    id: 'md-vitz',
    parentId: 'mk-toyota',
    dictionaryType: 'MODEL',
    canonicalValue: 'Vitz',
    aliases: [],
    vehicleTypes: ['CAR'],
  } as DictionaryRow,
]);

type Harness = ReturnType<typeof harness>;

const harness = (o: { csv?: string; chunkSize?: number } = {}) => {
  const csv = o.csv ?? [HEADER, ROW(1), ROW(2)].join('\n');
  const objects = new Map<string, Buffer>([['raw/job-1/stock.csv', Buffer.from(csv)]]);

  const store = {
    exists: jest.fn(async (k: string) => objects.has(k)),
    get: jest.fn(async (k: string) => objects.get(k) as Buffer),
    getStream: jest.fn(async (k: string) => Readable.from([objects.get(k) as Buffer])),
    put: jest.fn(async (k: string, body: string) => {
      objects.set(k, Buffer.from(body));
      return k;
    }),
    list: jest.fn(),
  };

  const uploadJobs = {
    findById: jest.fn().mockResolvedValue({
      id: 'job-1',
      dealerId: 'dealer-1',
      fileName: 'stock.csv',
      csvS3Path: 'raw/job-1/stock.csv',
    }),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    updateTotal: jest.fn().mockResolvedValue(undefined),
    updateCounts: jest.fn().mockResolvedValue(undefined),
  };

  const logger = {
    start: jest.fn().mockResolvedValue('log-1'),
    finish: jest.fn().mockResolvedValue(undefined),
  };

  const stageLogs = {
    forJob: jest.fn().mockReturnValue(logger),
    succeededChunks: jest.fn().mockResolvedValue(new Set<number>()),
  };

  const rejectedRecords = { insertMany: jest.fn().mockResolvedValue(undefined) };
  const dictionary = { loadSnapshot: jest.fn().mockResolvedValue(DICTIONARY) };
  const vehicles = {
    upsertBatch: jest.fn(async (_j: string, _d: string, rows: unknown[]) => ({
      loaded: rows.map((_, i) => ({ id: `v${i}`, registration_number: null })),
      rejections: [],
    })),
  };

  const config = {
    get: jest.fn((key: string) =>
      key === 'INGESTION_CHUNK_SIZE' ? String(o.chunkSize ?? 250) : undefined,
    ),
  };

  const orchestrator = new LocalOrchestrator(
    store as never,
    config as never,
    uploadJobs as never,
    stageLogs as never,
    rejectedRecords as never,
    dictionary as never,
    vehicles as never,
  );

  return {
    orchestrator,
    store,
    uploadJobs,
    stageLogs,
    logger,
    rejectedRecords,
    dictionary,
    vehicles,
  };
};

const statuses = (h: Harness): string[] =>
  h.uploadJobs.updateStatus.mock.calls.map((c) => c[1] as string);

beforeAll(() => {
  // The real embedder loads a ~90MB ONNX model; far too slow for a unit test.
  __setEmbedder({ embed: jest.fn().mockResolvedValue(Array(384).fill(0.1)) } as never);
});

afterAll(() => __setEmbedder(undefined));

describe('LocalOrchestrator', () => {
  it('runs a clean file end to end', async () => {
    const h = harness();

    await h.orchestrator.run('job-1');

    expect(statuses(h)).toEqual(['PROCESSING', 'COMPLETED']);
    expect(h.uploadJobs.updateCounts).toHaveBeenCalledWith('job-1', {
      validRecords: 2,
      invalidRecords: 0,
    });
  });

  it('marks the job PROCESSING before any work', async () => {
    // A dealer polling immediately after upload must not see PENDING while the
    // pipeline is already running.
    const h = harness();

    await h.orchestrator.run('job-1');

    expect(statuses(h)[0]).toBe('PROCESSING');
  });

  it('records the row total before fan-out', async () => {
    // A job that dies mid-flight still shows the denominator the progress bar
    // needs.
    const h = harness();

    await h.orchestrator.run('job-1');

    expect(h.uploadJobs.updateTotal).toHaveBeenCalledWith('job-1', 2);
  });

  it('loads the dictionary once per run, not per row', async () => {
    const h = harness({ csv: [HEADER, ROW(1), ROW(2), ROW(3), ROW(4)].join('\n') });

    await h.orchestrator.run('job-1');

    expect(h.dictionary.loadSnapshot).toHaveBeenCalledTimes(1);
  });

  describe('terminal status', () => {
    it('is PARTIAL when some rows were rejected', async () => {
      // The dealer got less than they uploaded and needs to know which rows.
      const h = harness({ csv: [HEADER, ROW(1), 'CAB-9,Toyota,Vitz,1850,3500000,45000'].join('\n') });

      await h.orchestrator.run('job-1');

      expect(statuses(h)).toContain('PARTIAL');
    });

    it('is FAILED when nothing landed at all', async () => {
      const h = harness({ csv: [HEADER, 'CAB-9,Toyota,Vitz,1850,-1,45000'].join('\n') });

      await h.orchestrator.run('job-1');

      expect(statuses(h)).toContain('FAILED');
    });

    it('is COMPLETED with zero counts for a header-only file', async () => {
      // An empty inventory is not a failure — the dealer uploaded nothing.
      const h = harness({ csv: `${HEADER}\n` });

      await h.orchestrator.run('job-1');

      expect(statuses(h)).toEqual(['PROCESSING', 'COMPLETED']);
      expect(h.uploadJobs.updateCounts).toHaveBeenCalledWith('job-1', {
        validRecords: 0,
        invalidRecords: 0,
      });
    });
  });

  describe('chunk isolation', () => {
    it('completes the other chunks when one fails', async () => {
      // THE correctness requirement: a dealer whose 400th row breaks the
      // writer should still get the rest, not a rejected upload.
      const h = harness({ csv: [HEADER, ROW(1), ROW(2), ROW(3), ROW(4)].join('\n'), chunkSize: 1 });

      // Keyed on the row rather than call order: chunks run concurrently, so
      // "reject the next two calls" would land on two different chunks' first
      // attempts and both would then succeed on retry.
      h.vehicles.upsertBatch.mockImplementation(async (_j, _d, rows: { rowNumber: number }[]) => {
        if (rows[0]?.rowNumber === 1) throw new Error('write failed');
        return {
          loaded: rows.map((_, i) => ({ id: `v${i}`, registration_number: null })),
          rejections: [],
        };
      });

      await h.orchestrator.run('job-1');

      // Chunk 0 exhausted both attempts; chunks 1-3 loaded.
      expect(statuses(h)).toContain('PARTIAL');
      expect(h.uploadJobs.updateCounts).toHaveBeenCalledWith('job-1', {
        validRecords: 3,
        invalidRecords: 0,
      });
    });

    it('does not let a failing chunk throw out of run()', async () => {
      const h = harness({ chunkSize: 1 });
      h.vehicles.upsertBatch.mockRejectedValue(new Error('write failed'));

      await expect(h.orchestrator.run('job-1')).resolves.toBeUndefined();
    });
  });

  describe('retry', () => {
    it('retries Load once before giving up', async () => {
      // Load failures are typically transient — a dropped connection or a lock
      // timeout — unlike a stage that rejected a row deterministically.
      const h = harness({ chunkSize: 2 });
      h.vehicles.upsertBatch
        .mockRejectedValueOnce(new Error('deadlock'))
        .mockResolvedValueOnce({ loaded: [{ id: 'v1', registration_number: null }], rejections: [] });

      await h.orchestrator.run('job-1');

      expect(h.vehicles.upsertBatch).toHaveBeenCalledTimes(2);
      expect(statuses(h)).toContain('COMPLETED');
    });

    it('logs the retry attempt number', async () => {
      const h = harness({ chunkSize: 2 });
      h.vehicles.upsertBatch
        .mockRejectedValueOnce(new Error('deadlock'))
        .mockResolvedValueOnce({ loaded: [], rejections: [] });

      await h.orchestrator.run('job-1');

      const loadStarts = h.logger.start.mock.calls.filter((c) => c[0] === 'LOAD');
      expect(loadStarts.map((c) => c[2])).toEqual([0, 1]);
    });
  });

  describe('idempotent re-run', () => {
    it('skips chunks already logged SUCCEEDED', async () => {
      // Rows with a null registration number miss both partial indexes, so a
      // re-run would insert them twice. The database cannot deduplicate what
      // it has no key for — skipping the chunk is what makes retry safe.
      const h = harness({ chunkSize: 1 });
      h.stageLogs.succeededChunks.mockResolvedValue(new Set([0]));

      await h.orchestrator.run('job-1');

      expect(h.vehicles.upsertBatch).toHaveBeenCalledTimes(1);
    });

    it('writes nothing at all when every chunk already loaded', async () => {
      const h = harness({ chunkSize: 1 });
      h.stageLogs.succeededChunks.mockResolvedValue(new Set([0, 1]));

      await h.orchestrator.run('job-1');

      expect(h.vehicles.upsertBatch).not.toHaveBeenCalled();
    });
  });

  describe('whole-file failure', () => {
    it('marks the job FAILED and records why', async () => {
      const h = harness({ csv: 'make,model\nToyota,Vitz\n' });

      await h.orchestrator.run('job-1');

      expect(statuses(h)).toContain('FAILED');
      expect(h.rejectedRecords.insertMany).toHaveBeenCalledWith('job-1', [
        expect.objectContaining({ rowNumber: 0, reason: expect.stringMatching(/year/) }),
      ]);
    });

    it('logs the failing stage rather than only the job', async () => {
      const h = harness({ csv: 'make,model\nToyota,Vitz\n' });

      await h.orchestrator.run('job-1');

      expect(h.logger.finish).toHaveBeenCalledWith('log-1', 'FAILED', expect.anything());
    });

    it('returns quietly when the job row does not exist', async () => {
      // There is no row to mark FAILED — it is the one that is missing.
      const h = harness();
      h.uploadJobs.findById.mockResolvedValue(null);

      await expect(h.orchestrator.run('job-1')).resolves.toBeUndefined();
      expect(h.uploadJobs.updateStatus).not.toHaveBeenCalled();
    });
  });

  it('writes rejections once per chunk', async () => {
    const h = harness({ csv: [HEADER, ROW(1), 'CAB-9,Toyota,Vitz,1850,3500000,45000'].join('\n') });

    await h.orchestrator.run('job-1');

    expect(h.rejectedRecords.insertMany).toHaveBeenCalledTimes(1);
    expect(h.rejectedRecords.insertMany.mock.calls[0][1]).toHaveLength(1);
  });

  it('passes the dealer id from the job to the writer', async () => {
    // Never from the CSV: an uploaded dealer_id column must not assign stock
    // to another dealer.
    const h = harness();

    await h.orchestrator.run('job-1');

    expect(h.vehicles.upsertBatch).toHaveBeenCalledWith('job-1', 'dealer-1', expect.anything());
  });
});
