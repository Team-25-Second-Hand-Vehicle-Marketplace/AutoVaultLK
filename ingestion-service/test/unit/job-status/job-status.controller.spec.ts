import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { JobStatusController } from '../../../src/modules/job-status/controllers/job-status.controller';

describe('JobStatusController', () => {
  const service = { getJobStatus: jest.fn(), getRejectedRecords: jest.fn() };
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

  describe('getRejections (FR-57)', () => {
    const dealer = {
      id: 'dealer-1',
      email: 'd@example.com',
      role: 'DEALER' as const,
    };

    it('is mounted at :id/rejections under the same /jobs prefix', () => {
      // Read off the prototype descriptor rather than the method itself:
      // referencing the method directly trips no-unbound-method, and the
      // route metadata hangs off the same function either way.
      const handler = Object.getOwnPropertyDescriptor(
        JobStatusController.prototype,
        'getRejections',
      )?.value as unknown;

      expect(Reflect.getMetadata(PATH_METADATA, handler as object)).toBe(
        ':id/rejections',
      );
    });

    // The dealer scope comes from the verified token, never the request — the
    // same property GET /jobs/:id relies on.
    it('passes the authenticated user id through as the dealer scope', async () => {
      service.getRejectedRecords.mockResolvedValue({ items: [] });

      await controller.getRejections('job-1', {}, dealer);

      expect(service.getRejectedRecords).toHaveBeenCalledWith(
        'job-1',
        'dealer-1',
        {},
      );
    });

    it('forwards the pagination query', async () => {
      service.getRejectedRecords.mockResolvedValue({ items: [] });

      await controller.getRejections('job-1', { page: 2, limit: 20 }, dealer);

      expect(service.getRejectedRecords).toHaveBeenCalledWith(
        'job-1',
        'dealer-1',
        {
          page: 2,
          limit: 20,
        },
      );
    });

    it('returns the service result unchanged', async () => {
      const dto = { items: [], total: 0, page: 1, limit: 50, totalPages: 0 };
      service.getRejectedRecords.mockResolvedValue(dto);

      await expect(controller.getRejections('job-1', {}, dealer)).resolves.toBe(
        dto,
      );
    });
  });
});
