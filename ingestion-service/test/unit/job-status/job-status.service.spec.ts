import { NotFoundException } from '@nestjs/common';
import { JobStatusService } from '../../../src/modules/job-status/services/job-status.service';
import type { UploadJob } from '../../../src/infrastructure/database/entities/upload-job.entity';

/**
 * Also serves as the canary for the jest `rootDir` fix: before it, rootDir was
 * "src" and nothing under test/ was ever discovered, so a suite like this would
 * silently never run.
 */
describe('JobStatusService', () => {
  const repository = { findById: jest.fn() };
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
    service = new JobStatusService(repository as never);
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
});
