import { JobStatusRepository } from '../../../src/modules/job-status/repositories/job-status.repository';
import { UploadJob } from '../../../src/infrastructure/database/entities/upload-job.entity';

/**
 * The query builder is stubbed, so what these assert is the *shape* of the
 * query — specifically that the dealer scope is inside it. That is the whole
 * security property of the endpoint: see the note on findRejectedRecords.
 */
describe('JobStatusRepository', () => {
  const qb = {
    innerJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getManyAndCount: jest.fn(),
  };

  const uploadJobRepository = { findOne: jest.fn() };
  const rejectedRecordRepository = { createQueryBuilder: jest.fn(() => qb) };

  let repository: JobStatusRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of [
      'innerJoin',
      'where',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ]) {
      (qb as never as Record<string, jest.Mock>)[key].mockReturnValue(qb);
    }
    qb.getManyAndCount.mockResolvedValue([[], 0]);

    repository = new JobStatusRepository(
      uploadJobRepository as never,
      rejectedRecordRepository as never,
    );
  });

  describe('findRejectedRecords', () => {
    it('joins upload_jobs on dealer_id so a non-owner matches no rows', async () => {
      await repository.findRejectedRecords('job-1', 'dealer-1', 1, 50);

      expect(qb.innerJoin).toHaveBeenCalledWith(
        UploadJob,
        'job',
        expect.stringContaining('job.dealer_id = :dealerId'),
        { dealerId: 'dealer-1' },
      );
    });

    it('filters to the requested job', async () => {
      await repository.findRejectedRecords('job-1', 'dealer-1', 1, 50);

      expect(qb.where).toHaveBeenCalledWith(
        'rejected.upload_job_id = :uploadJobId',
        { uploadJobId: 'job-1' },
      );
    });

    // Row order is the report's readability: the dealer reads it against their
    // own file, top to bottom.
    it('orders by row number, then stage', async () => {
      await repository.findRejectedRecords('job-1', 'dealer-1', 1, 50);

      expect(qb.orderBy).toHaveBeenCalledWith('rejected.row_number', 'ASC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('rejected.stage', 'ASC');
    });

    it('translates page/limit into skip/take', async () => {
      await repository.findRejectedRecords('job-1', 'dealer-1', 3, 20);

      expect(qb.skip).toHaveBeenCalledWith(40);
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('starts the first page at offset 0', async () => {
      await repository.findRejectedRecords('job-1', 'dealer-1', 1, 50);

      expect(qb.skip).toHaveBeenCalledWith(0);
    });

    it('returns the rows with the unpaged total', async () => {
      const row = { rowNumber: 4 };
      qb.getManyAndCount.mockResolvedValue([[row], 17]);

      await expect(
        repository.findRejectedRecords('job-1', 'dealer-1', 1, 50),
      ).resolves.toEqual({ rows: [row], total: 17 });
    });
  });
});
