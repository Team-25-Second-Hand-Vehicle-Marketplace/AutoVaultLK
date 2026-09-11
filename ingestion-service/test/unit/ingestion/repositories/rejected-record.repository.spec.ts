import { RejectedRecordRepository } from '../../../../src/modules/ingestion/repositories/rejected-record.repository';
import {
  rejection,
  type Rejection,
} from '../../../../src/workers/etl-worker/pipeline/types';

describe('RejectedRecordRepository', () => {
  const repo = { query: jest.fn(), count: jest.fn(), findAndCount: jest.fn() };
  let repository: RejectedRecordRepository;

  const make = (rowNumber: number): Rejection =>
    rejection({ rowNumber, raw: { make: 'Toyoat' } }, 'unknown make');

  const sqlOf = (call = 0): string => repo.query.mock.calls[call][0] as string;
  const paramsOf = (call = 0): unknown[] => repo.query.mock.calls[call][1] as unknown[];

  beforeEach(() => {
    jest.clearAllMocks();
    repo.query.mockResolvedValue([]);
    repository = new RejectedRecordRepository(repo as never);
  });

  describe('insertMany', () => {
    // Called once per stage per chunk whether or not anything failed, so the
    // empty case is the common one and must not cost a round trip.
    it('issues no statement for an empty list', async () => {
      await repository.insertMany('job-1', 'VALIDATE_ROWS', []);

      expect(repo.query).not.toHaveBeenCalled();
    });

    it('stamps every row with the job id and the producing stage', async () => {
      await repository.insertMany('job-1', 'VALIDATE_ROWS', [make(1), make(2)]);

      const params = paramsOf();
      expect(params.slice(0, 3)).toEqual(['job-1', 'VALIDATE_ROWS', 1]);
      expect(params.slice(5, 8)).toEqual(['job-1', 'VALIDATE_ROWS', 2]);
    });

    it('carries the raw row and reason through', async () => {
      await repository.insertMany('job-1', 'VALIDATE_ROWS', [make(5)]);

      expect(paramsOf()).toEqual([
        'job-1',
        'VALIDATE_ROWS',
        5,
        JSON.stringify({ make: 'Toyoat' }),
        'unknown make',
      ]);
    });

    describe('idempotency', () => {
      // Under Step Functions each stage is its own Lambda and ASL retries a
      // failed state. A stage that rejected rows before failing would
      // otherwise insert them twice, and the dealer would see one bad row
      // listed as two with no way to tell.
      it('upserts on (job, stage, row) rather than plain inserting', async () => {
        await repository.insertMany('job-1', 'VALIDATE_ROWS', [make(1)]);

        expect(sqlOf()).toMatch(
          /ON CONFLICT \(upload_job_id, stage, row_number\) WHERE row_number > 0/,
        );
      });

      it('replaces rather than skips, so a newer reason wins', async () => {
        // A retry that produces a different reason — a transient dependency
        // recovering — should show the newer one, not the stale one.
        await repository.insertMany('job-1', 'VALIDATE_ROWS', [make(1)]);

        expect(sqlOf()).toMatch(/DO UPDATE SET raw_data = EXCLUDED\.raw_data/);
        expect(sqlOf()).not.toMatch(/DO NOTHING/);
      });

      it('keys a whole-file rejection on (job, stage) alone', async () => {
        // Row 0 is the whole-file rejection validateFile writes; there is no
        // row number to key on, so it needs the other partial index.
        await repository.insertMany('job-1', 'VALIDATE_FILE', [
          { rowNumber: 0, rawData: {}, reason: 'no header row' },
        ]);

        expect(sqlOf()).toMatch(/ON CONFLICT \(upload_job_id, stage\) WHERE row_number = 0/);
      });

      it('splits file-level and row-level rejections into separate statements', async () => {
        // The two partial indexes need different conflict targets, and
        // Postgres cannot express both in one statement.
        await repository.insertMany('job-1', 'VALIDATE_ROWS', [
          { rowNumber: 0, rawData: {}, reason: 'file level' },
          make(1),
        ]);

        expect(repo.query).toHaveBeenCalledTimes(2);
        expect(sqlOf(0)).toMatch(/row_number > 0/);
        expect(sqlOf(1)).toMatch(/row_number = 0/);
      });
    });

    it('sends a single chunk of rejections as one statement', async () => {
      await repository.insertMany(
        'job-1',
        'VALIDATE_ROWS',
        Array.from({ length: 250 }, (_, i) => make(i + 1)),
      );

      expect(repo.query).toHaveBeenCalledTimes(1);
    });

    // A pathological file can reject every row; batching keeps the statement
    // (and its parameter count) bounded.
    it('splits beyond the batch size', async () => {
      await repository.insertMany(
        'job-1',
        'VALIDATE_ROWS',
        Array.from({ length: 1200 }, (_, i) => make(i + 1)),
      );

      expect(repo.query).toHaveBeenCalledTimes(3);
      expect(paramsOf(0)).toHaveLength(500 * 5);
      expect(paramsOf(2)).toHaveLength(200 * 5);
    });

    it('preserves row order across batches', async () => {
      await repository.insertMany(
        'job-1',
        'VALIDATE_ROWS',
        Array.from({ length: 501 }, (_, i) => make(i + 1)),
      );

      // Third parameter of the second statement's first tuple is its row number.
      expect(paramsOf(1)[2]).toBe(501);
    });

    it('casts raw_data to jsonb', async () => {
      await repository.insertMany('job-1', 'VALIDATE_ROWS', [make(1)]);

      expect(sqlOf()).toMatch(/::jsonb/);
    });
  });

  describe('reads', () => {
    it('counts rejections for a job', async () => {
      repo.count.mockResolvedValue(3);

      await expect(repository.countForJob('job-1')).resolves.toBe(3);
      expect(repo.count).toHaveBeenCalledWith({ where: { uploadJobId: 'job-1' } });
    });

    it('returns rejections ordered by row number, paginated', async () => {
      repo.findAndCount.mockResolvedValue([[{ rowNumber: 1 }], 1]);

      await expect(repository.findForJob('job-1', 10, 20)).resolves.toEqual({
        items: [{ rowNumber: 1 }],
        total: 1,
      });
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { rowNumber: 'ASC' },
          take: 10,
          skip: 20,
        }),
      );
    });
  });
});
