import { InProcessJobQueue } from '../../../src/infrastructure/queue/in-process-job-queue';
import { QueueBootstrapService } from '../../../src/modules/ingestion/queue-bootstrap.service';

const flush = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Temporary scaffolding: delete this suite together with QueueBootstrapService
 * when LocalOrchestrator lands (plan §A8).
 */
describe('QueueBootstrapService', () => {
  const uploadJobs = { updateStatus: jest.fn() };
  let queue: InProcessJobQueue;
  let service: QueueBootstrapService;

  beforeEach(() => {
    jest.clearAllMocks();
    uploadJobs.updateStatus.mockResolvedValue(undefined);
    queue = new InProcessJobQueue();
    jest.spyOn(queue['logger'], 'error').mockImplementation(() => undefined);
    service = new QueueBootstrapService(queue, uploadJobs as never);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  // Without a registered handler, publish() throws and Dev B's very first
  // POST /ingest/upload 500s instead of returning 202.
  it('registers a handler so publish does not throw', () => {
    service.onApplicationBootstrap();

    expect(() => queue.publish({ jobId: 'job-1' })).not.toThrow();
  });

  it('throws without the bootstrap, proving the placeholder is what fixes it', () => {
    expect(() => queue.publish({ jobId: 'job-1' })).toThrow(/no handler registered/);
  });

  // FAILED, not left PENDING: the state must be honest about the fact that the
  // upload was accepted and nothing processed it.
  it('marks the job FAILED rather than leaving it PENDING forever', async () => {
    service.onApplicationBootstrap();

    await queue.publish({ jobId: 'job-1' });
    await flush();

    expect(uploadJobs.updateStatus).toHaveBeenCalledWith('job-1', 'FAILED');
  });

  it('warns loudly at boot and per job so the gap is not mistaken for working', async () => {
    service.onApplicationBootstrap();
    expect(service['logger'].warn).toHaveBeenCalledWith(
      expect.stringContaining('Placeholder ETL handler registered'),
    );

    await queue.publish({ jobId: 'job-9' });
    await flush();

    expect(service['logger'].warn).toHaveBeenCalledWith(expect.stringContaining('job-9'));
  });
});
