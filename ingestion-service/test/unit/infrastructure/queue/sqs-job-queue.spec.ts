import { SqsJobQueue } from '../../../../src/infrastructure/queue/sqs-job-queue';

const send = jest.fn();

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send })),
  SendMessageCommand: class {
    constructor(public readonly input: Record<string, unknown>) {}
  },
}));

const QUEUE_URL = 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/ingestion-jobs';

const config = (...args: [] | [string | undefined]) => {
  const url = args.length === 0 ? QUEUE_URL : args[0];
  return {
    get: (key: string) => (key === 'INGESTION_SQS_QUEUE_URL' ? url : 'ap-southeast-1'),
  } as never;
};

const inputOf = (): Record<string, unknown> =>
  (send.mock.calls[0][0] as { input: Record<string, unknown> }).input;

describe('SqsJobQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    send.mockResolvedValue({ MessageId: 'm-1' });
  });

  describe('construction', () => {
    it('refuses to start without a queue url', () => {
      // A service that starts, stores an upload and only then finds it cannot
      // trigger the pipeline has already answered 202 to the dealer.
      expect(() => new SqsJobQueue(config(undefined))).toThrow(/INGESTION_SQS_QUEUE_URL/);
      expect(() => new SqsJobQueue(config('  '))).toThrow(/INGESTION_SQS_QUEUE_URL/);
    });
  });

  describe('publish', () => {
    it('sends the job id to the configured queue', async () => {
      await new SqsJobQueue(config()).publish({ jobId: 'job-1' });

      expect(inputOf()).toMatchObject({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({ jobId: 'job-1' }),
      });
    });

    it('sends only the id, never a payload', async () => {
      // The pipeline re-reads the job row rather than trusting a message, so a
      // redelivered or replayed message cannot resurrect stale field values.
      await new SqsJobQueue(config()).publish({ jobId: 'job-1' });

      expect(JSON.parse(inputOf().MessageBody as string)).toEqual({ jobId: 'job-1' });
    });

    it('propagates a send failure rather than swallowing it', async () => {
      // The caller has already stored the file and created the job row. A
      // swallowed error leaves a PENDING job nothing will ever process, and a
      // dealer polling a status that never changes.
      send.mockRejectedValue(new Error('throttled'));

      await expect(new SqsJobQueue(config()).publish({ jobId: 'job-1' })).rejects.toThrow(
        /throttled/,
      );
    });

    it('does not set FIFO fields on a standard queue', async () => {
      // Ordering does not matter — each message is an independent job — and
      // idempotency comes from the pipeline's succeededChunks skip, not the
      // queue.
      await new SqsJobQueue(config()).publish({ jobId: 'job-1' });

      expect(inputOf()).not.toHaveProperty('MessageGroupId');
      expect(inputOf()).not.toHaveProperty('MessageDeduplicationId');
    });
  });

  it('has no setHandler — Step Functions consumes the queue, not this process', () => {
    // A no-op setHandler would be worse than its absence: the absence is a
    // compile error, the no-op is a support ticket.
    expect((new SqsJobQueue(config()) as unknown as Record<string, unknown>).setHandler).toBeUndefined();
  });
});
