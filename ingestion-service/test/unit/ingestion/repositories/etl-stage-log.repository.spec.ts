import { EtlStageLogRepository } from '../../../../src/modules/ingestion/repositories/etl-stage-log.repository';

describe('EtlStageLogRepository', () => {
  const repo = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    find: jest.fn(),
  };
  let repository: EtlStageLogRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.create.mockImplementation((v: unknown) => v);
    repo.save.mockResolvedValue({ id: 'log-1' });
    repo.update.mockResolvedValue({ affected: 1 });
    repository = new EtlStageLogRepository(repo as never);
  });

  describe('start', () => {
    it('opens the log STARTED with a start time and returns its id', async () => {
      await expect(repository.start('job-1', 'LOAD', 3)).resolves.toBe('log-1');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uploadJobId: 'job-1',
          stage: 'LOAD',
          status: 'STARTED',
          chunkId: 3,
          retryCount: 0,
          startedAt: expect.any(Date),
        }),
      );
    });

    it('records the retry count when a stage is re-run', async () => {
      await repository.start('job-1', 'LOAD', 3, 2);

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ retryCount: 2 }));
    });

    // Whole-file stages carry no chunk; the column is nullable for exactly this.
    it('accepts a null chunk id for whole-file stages', async () => {
      await repository.start('job-1', 'VALIDATE_FILE', null);

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ chunkId: null }));
    });
  });

  describe('finish', () => {
    it('closes the log with a status and completion time', async () => {
      await repository.finish('log-1', 'SUCCEEDED');

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        expect.objectContaining({ status: 'SUCCEEDED', completedAt: expect.any(Date) }),
      );
    });

    it('stores metrics, defaulting to an empty object', async () => {
      await repository.finish('log-1', 'SUCCEEDED', { metrics: { meanConfidence: 0.82 } });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        expect.objectContaining({ metrics: { meanConfidence: 0.82 } }),
      );

      await repository.finish('log-2', 'SUCCEEDED');
      expect(repo.update).toHaveBeenLastCalledWith(
        { id: 'log-2' },
        expect.objectContaining({ metrics: {} }),
      );
    });

    it('records a DEGRADED outcome distinctly from FAILED', async () => {
      await repository.finish('log-1', 'DEGRADED', { errorMessage: 'MiniLM unavailable' });

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        expect.objectContaining({ status: 'DEGRADED' }),
      );
    });

    // A full stack per row would bloat the table without adding signal.
    it('truncates an over-long error message', async () => {
      await repository.finish('log-1', 'FAILED', { errorMessage: 'x'.repeat(5000) });

      const payload = repo.update.mock.calls[0][1] as { errorMessage: string };
      expect(payload.errorMessage).toHaveLength(2000);
    });

    it('nulls the error message when none is given', async () => {
      await repository.finish('log-1', 'SUCCEEDED');

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        expect.objectContaining({ errorMessage: null }),
      );
    });
  });

  describe('forJob', () => {
    it('binds the job id so stages never pass it', async () => {
      const logger = repository.forJob('job-7');

      await logger.start('EMBED', 2);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ uploadJobId: 'job-7', stage: 'EMBED', chunkId: 2 }),
      );
    });

    it('forwards finish through unchanged', async () => {
      await repository.forJob('job-7').finish('log-1', 'SUCCEEDED');

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        expect.objectContaining({ status: 'SUCCEEDED' }),
      );
    });
  });

  describe('succeededChunks', () => {
    /**
     * The retry-idempotency guard. Rows carrying a registration number are
     * protected by the partial unique index, but rows with a NULL registration
     * (legitimate for unregistered imports) match no index and would insert
     * twice. Skipping already-SUCCEEDED chunks is what protects them.
     */
    it('returns the chunk ids already succeeded for a stage', async () => {
      repo.find.mockResolvedValue([{ chunkId: 0 }, { chunkId: 2 }]);

      await expect(repository.succeededChunks('job-1', 'LOAD')).resolves.toEqual(
        new Set([0, 2]),
      );
    });

    it('queries only SUCCEEDED rows for that job and stage', async () => {
      repo.find.mockResolvedValue([]);

      await repository.succeededChunks('job-1', 'LOAD');

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { uploadJobId: 'job-1', stage: 'LOAD', status: 'SUCCEEDED' },
        }),
      );
    });

    // Whole-file stages log a null chunk; including it would make the set
    // meaningless as a chunk filter.
    it('drops null chunk ids', async () => {
      repo.find.mockResolvedValue([{ chunkId: null }, { chunkId: 1 }]);

      await expect(repository.succeededChunks('job-1', 'LOAD')).resolves.toEqual(
        new Set([1]),
      );
    });

    it('is empty for a job that has never run', async () => {
      repo.find.mockResolvedValue([]);

      await expect(repository.succeededChunks('job-1', 'LOAD')).resolves.toEqual(new Set());
    });
  });

  describe('findForJob', () => {
    it('returns stage logs oldest first', async () => {
      repo.find.mockResolvedValue([]);

      await repository.findForJob('job-1');

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { uploadJobId: 'job-1' },
          order: { startedAt: 'ASC', chunkId: 'ASC' },
        }),
      );
    });
  });
});
