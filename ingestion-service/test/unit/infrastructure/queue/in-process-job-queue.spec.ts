import { InProcessJobQueue } from '../../../../src/infrastructure/queue/in-process-job-queue';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('InProcessJobQueue', () => {
  let queue: InProcessJobQueue;

  beforeEach(() => {
    queue = new InProcessJobQueue();
    jest.spyOn(queue['logger'], 'error').mockImplementation(() => undefined);
  });

  // The whole point of the port: POST /ingest/upload must answer 202 without
  // waiting for the ETL run.
  it('resolves before the handler runs', async () => {
    const order: string[] = [];
    queue.setHandler(() => {
      order.push('handler');
      return Promise.resolve();
    });

    await queue.publish({ jobId: 'job-1' });
    order.push('published');
    await flush();

    expect(order).toEqual(['published', 'handler']);
  });

  it('passes the message through to the handler', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    queue.setHandler(handler);

    await queue.publish({ jobId: 'job-42' });
    await flush();

    expect(handler).toHaveBeenCalledWith({ jobId: 'job-42' });
  });

  // A crashed pipeline must not take down the process still serving
  // GET /jobs/{id} polls for every other dealer.
  it('swallows and logs a rejected handler instead of throwing', async () => {
    queue.setHandler(() => Promise.reject(new Error('pipeline exploded')));

    await expect(queue.publish({ jobId: 'job-1' })).resolves.toBeUndefined();
    await flush();

    expect(queue['logger'].error).toHaveBeenCalledWith(
      expect.stringContaining('pipeline exploded'),
    );
  });

  it('names the job in the failure log', async () => {
    queue.setHandler(() => Promise.reject(new Error('boom')));

    await queue.publish({ jobId: 'job-99' });
    await flush();

    expect(queue['logger'].error).toHaveBeenCalledWith(expect.stringContaining('job-99'));
  });

  // Losing the trigger silently would look exactly like a successful upload:
  // 202 returned, job row PENDING forever, dealer polling a job that will
  // never move.
  it('throws when no handler has been registered', () => {
    expect(() => queue.publish({ jobId: 'job-1' })).toThrow(/no handler registered/);
  });

  it('uses the most recently registered handler', async () => {
    const first = jest.fn().mockResolvedValue(undefined);
    const second = jest.fn().mockResolvedValue(undefined);

    queue.setHandler(first);
    queue.setHandler(second);
    await queue.publish({ jobId: 'job-1' });
    await flush();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
