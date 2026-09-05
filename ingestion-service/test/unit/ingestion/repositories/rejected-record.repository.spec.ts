import { RejectedRecordRepository } from '../../../../src/modules/ingestion/repositories/rejected-record.repository';
import {
  rejection,
  type Rejection,
} from '../../../../src/workers/etl-worker/pipeline/types';

describe('RejectedRecordRepository', () => {
  const repo = { insert: jest.fn(), count: jest.fn(), findAndCount: jest.fn() };
  let repository: RejectedRecordRepository;

  const make = (rowNumber: number): Rejection =>
    rejection({ rowNumber, raw: { make: 'Toyoat' } }, 'unknown make');

  beforeEach(() => {
    jest.clearAllMocks();
    repo.insert.mockResolvedValue({ identifiers: [] });
    repository = new RejectedRecordRepository(repo as never);
  });

  describe('insertMany', () => {
    // Called once per chunk whether or not anything failed, so the empty case
    // is the common one and must not cost a round trip.
    it('issues no statement for an empty list', async () => {
      await repository.insertMany('job-1', []);

      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('stamps every row with the job id', async () => {
      await repository.insertMany('job-1', [make(1), make(2)]);

      expect(repo.insert).toHaveBeenCalledWith([
        expect.objectContaining({ uploadJobId: 'job-1', rowNumber: 1 }),
        expect.objectContaining({ uploadJobId: 'job-1', rowNumber: 2 }),
      ]);
    });

    it('carries the raw row and reason through', async () => {
      await repository.insertMany('job-1', [make(5)]);

      expect(repo.insert).toHaveBeenCalledWith([
        expect.objectContaining({
          rawData: { make: 'Toyoat' },
          reason: 'unknown make',
        }),
      ]);
    });

    it('sends a single chunk of rejections as one statement', async () => {
      await repository.insertMany(
        'job-1',
        Array.from({ length: 250 }, (_, i) => make(i + 1)),
      );

      expect(repo.insert).toHaveBeenCalledTimes(1);
    });

    // A pathological file can reject every row; batching keeps the statement
    // (and its parameter count) bounded.
    it('splits beyond the batch size', async () => {
      await repository.insertMany(
        'job-1',
        Array.from({ length: 1200 }, (_, i) => make(i + 1)),
      );

      expect(repo.insert).toHaveBeenCalledTimes(3);
      expect((repo.insert.mock.calls[0][0] as unknown[]).length).toBe(500);
      expect((repo.insert.mock.calls[2][0] as unknown[]).length).toBe(200);
    });

    it('preserves row order across batches', async () => {
      await repository.insertMany(
        'job-1',
        Array.from({ length: 501 }, (_, i) => make(i + 1)),
      );

      const last = repo.insert.mock.calls[1][0] as Array<{ rowNumber: number }>;
      expect(last[0].rowNumber).toBe(501);
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
