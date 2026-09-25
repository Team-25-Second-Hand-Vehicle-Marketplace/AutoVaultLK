import { NotFoundException } from '@nestjs/common';
import { JobStatusService } from '../../../src/modules/job-status/services/job-status.service';
import type { UploadJob } from '../../../src/infrastructure/database/entities/upload-job.entity';

/**
 * Also serves as the canary for the jest `rootDir` fix: before it, rootDir was
 * "src" and nothing under test/ was ever discovered, so a suite like this would
 * silently never run.
 */
describe('JobStatusService', () => {
  const repository = { findById: jest.fn(), findRejectedRecords: jest.fn() };
  const stageLogRepository = { findForJob: jest.fn() };
  let service: JobStatusService;

  const job = (overrides: Partial<UploadJob> = {}): UploadJob =>
    ({
      id: 'job-1',
      dealerId: 'dealer-1',
      fileName: 'inventory.csv',
      status: 'PARTIAL',
      totalRecords: 50,
      validRecords: 47,
      invalidRecords: 3,
      createdAt: new Date('2026-09-01T10:00:00Z'),
      updatedAt: new Date('2026-09-01T10:05:00Z'),
      ...overrides,
    }) as UploadJob;

  beforeEach(() => {
    jest.clearAllMocks();
    stageLogRepository.findForJob.mockResolvedValue([]);
    service = new JobStatusService(
      repository as never,
      stageLogRepository as never,
    );
  });

  it('returns the job for its owning dealer', async () => {
    repository.findById.mockResolvedValue(job());

    await expect(service.getJobStatus('job-1', 'dealer-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'job-1',
        status: 'PARTIAL',
        totalRecords: 50,
        validRecords: 47,
        invalidRecords: 3,
      }),
    );
  });

  it('includes per-stage progress from the ETL stage log', async () => {
    repository.findById.mockResolvedValue(job());
    stageLogRepository.findForJob.mockResolvedValue([
      {
        stage: 'EMBED',
        status: 'SUCCEEDED',
        chunkId: 2,
        retryCount: 0,
        startedAt: new Date('2026-09-01T10:01:00Z'),
        completedAt: new Date('2026-09-01T10:01:30Z'),
        errorMessage: null,
      },
    ]);

    const result = await service.getJobStatus('job-1', 'dealer-1');

    expect(stageLogRepository.findForJob).toHaveBeenCalledWith('job-1');
    expect(result.stages).toEqual([
      expect.objectContaining({
        stage: 'EMBED',
        status: 'SUCCEEDED',
        chunkId: 2,
        retryCount: 0,
      }),
    ]);
  });

  it('scopes the lookup by dealer, not just job id', async () => {
    repository.findById.mockResolvedValue(job());

    await service.getJobStatus('job-1', 'dealer-1');

    expect(repository.findById).toHaveBeenCalledWith('job-1', 'dealer-1');
  });

  // A dealer asking for someone else's job gets the same answer as one asking
  // for a job that does not exist — the query is dealer-scoped, so a non-owner
  // simply matches no row.
  it('throws NotFound when no row matches', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(
      service.getJobStatus('job-1', 'other-dealer'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not leak the storage path in the response', async () => {
    repository.findById.mockResolvedValue(job());

    const result = await service.getJobStatus('job-1', 'dealer-1');

    expect(result).not.toHaveProperty('csvS3Path');
    expect(result).not.toHaveProperty('zipS3Path');
  });

  describe('getRejectedRecords (FR-57)', () => {
    const rejection = (overrides: Record<string, unknown> = {}) => ({
      rowNumber: 17,
      stage: 'VALIDATE_ROWS',
      reason: 'manufacture_year 1972 is outside the accepted range',
      rawData: { registration: 'CAB-1234', manufacture_year: '1972' },
      createdAt: new Date('2026-09-01T10:03:00Z'),
      ...overrides,
    });

    beforeEach(() => {
      repository.findById.mockResolvedValue(job());
      repository.findRejectedRecords.mockResolvedValue({ rows: [], total: 0 });
    });

    it('returns the rejected rows for the owning dealer', async () => {
      repository.findRejectedRecords.mockResolvedValue({
        rows: [rejection()],
        total: 1,
      });

      const result = await service.getRejectedRecords('job-1', 'dealer-1', {});

      expect(result.items).toEqual([
        expect.objectContaining({
          rowNumber: 17,
          stage: 'VALIDATE_ROWS',
          reason: 'manufacture_year 1972 is outside the accepted range',
        }),
      ]);
      expect(result.total).toBe(1);
    });

    it('scopes the rejection query by dealer, not just job id', async () => {
      await service.getRejectedRecords('job-1', 'dealer-1', {});

      expect(repository.findRejectedRecords).toHaveBeenCalledWith(
        'job-1',
        'dealer-1',
        1,
        50,
      );
    });

    // Same reasoning as getJobStatus: a foreign job and a missing job must be
    // indistinguishable, or the 404/403 split becomes an id oracle.
    it("throws NotFound for another dealer's job before querying rejections", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.getRejectedRecords('job-1', 'other-dealer', {}),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(repository.findRejectedRecords).not.toHaveBeenCalled();
    });

    // A clean upload is the expected case, not an error.
    it('returns an empty page for a job with no rejections', async () => {
      const result = await service.getRejectedRecords('job-1', 'dealer-1', {});

      expect(result).toEqual(
        expect.objectContaining({ items: [], total: 0, totalPages: 0 }),
      );
    });

    it('applies the requested page and limit', async () => {
      await service.getRejectedRecords('job-1', 'dealer-1', {
        page: 3,
        limit: 20,
      });

      expect(repository.findRejectedRecords).toHaveBeenCalledWith(
        'job-1',
        'dealer-1',
        3,
        20,
      );
    });

    it('reports totalPages from the unpaged total', async () => {
      repository.findRejectedRecords.mockResolvedValue({
        rows: [],
        total: 101,
      });

      const result = await service.getRejectedRecords('job-1', 'dealer-1', {
        limit: 50,
      });

      expect(result.totalPages).toBe(3);
    });

    // A 60-column export would otherwise make the response mostly payload the
    // dealer never reads.
    it('caps rawData and flags that it did so', async () => {
      const wide: Record<string, unknown> = {};
      for (let i = 0; i < 40; i += 1) wide[`col_${i}`] = i;
      repository.findRejectedRecords.mockResolvedValue({
        rows: [rejection({ rawData: wide })],
        total: 1,
      });

      const [item] = (await service.getRejectedRecords('job-1', 'dealer-1', {}))
        .items;

      expect(Object.keys(item.rawData)).toHaveLength(24);
      expect(item.rawDataTruncated).toBe(true);
    });

    it('leaves a normal-width row untouched', async () => {
      repository.findRejectedRecords.mockResolvedValue({
        rows: [rejection()],
        total: 1,
      });

      const [item] = (await service.getRejectedRecords('job-1', 'dealer-1', {}))
        .items;

      expect(item.rawData).toEqual({
        registration: 'CAB-1234',
        manufacture_year: '1972',
      });
      expect(item.rawDataTruncated).toBe(false);
    });

    // rowNumber 0 is the whole-file rejection, not a row — it must survive the
    // mapping rather than be treated as falsy and dropped.
    it('preserves a whole-file rejection at row 0', async () => {
      repository.findRejectedRecords.mockResolvedValue({
        rows: [
          rejection({
            rowNumber: 0,
            stage: 'VALIDATE_FILE',
            reason: 'missing required column: make',
          }),
        ],
        total: 1,
      });

      const [item] = (await service.getRejectedRecords('job-1', 'dealer-1', {}))
        .items;

      expect(item.rowNumber).toBe(0);
      expect(item.stage).toBe('VALIDATE_FILE');
    });
  });
});
