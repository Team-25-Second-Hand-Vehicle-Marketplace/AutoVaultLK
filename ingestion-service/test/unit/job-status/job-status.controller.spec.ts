import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { JobStatusController } from '../../../src/modules/job-status/controllers/job-status.controller';

describe('JobStatusController', () => {
  const service = { getJobStatus: jest.fn() };
  let controller: JobStatusController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new JobStatusController(service as never);
  });

  /**
   * The published contract is GET /jobs/{jobId} (api-gateway/openapi/public-api.yaml)
   * and nginx proxies `location /jobs/` WITHOUT stripping the prefix, so the
   * service must answer on /jobs. It previously answered on /upload-jobs, which
   * meant every call through the gateway 404'd. Pinned here so the route cannot
   * drift back without a red test.
   */
  it('is mounted at /jobs to match the gateway contract', () => {
    expect(Reflect.getMetadata(PATH_METADATA, JobStatusController)).toBe(
      'jobs',
    );
  });

  it('passes the authenticated user id through as the dealer scope', async () => {
    service.getJobStatus.mockResolvedValue({ id: 'job-1' });

    await controller.getJobStatus('job-1', {
      id: 'dealer-1',
      email: 'd@example.com',
      role: 'DEALER',
    });

    expect(service.getJobStatus).toHaveBeenCalledWith('job-1', 'dealer-1');
  });

  it('returns the service result unchanged', async () => {
    const dto = { id: 'job-1', status: 'COMPLETED' };
    service.getJobStatus.mockResolvedValue(dto);

    await expect(
      controller.getJobStatus('job-1', {
        id: 'dealer-1',
        email: 'd@example.com',
        role: 'DEALER',
      }),
    ).resolves.toBe(dto);
  });
});
