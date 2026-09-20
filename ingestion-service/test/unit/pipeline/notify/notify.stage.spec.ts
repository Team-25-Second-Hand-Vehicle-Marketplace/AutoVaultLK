import { runNotifyStage } from '../../../../src/workers/etl-worker/pipeline/notify/notify.stage';
import type { NotifyInput } from '../../../../src/workers/etl-worker/pipeline/notify/notify.stage';

const BASE: NotifyInput = {
  jobId: '9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d',
  dealerId: '3f6f6b4e-1c2d-4a5b-8c9d-0e1f2a3b4c5d',
  fileName: 'stock.csv',
  status: 'COMPLETED',
  validRecords: 40,
  invalidRecords: 0,
};

const input = (overrides: Partial<NotifyInput> = {}): NotifyInput => ({ ...BASE, ...overrides });

/** The JSON body of the single fetch call. */
const sentBody = (): Record<string, unknown> =>
  JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string) as Record<
    string,
    unknown
  >;

const accepts = () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 202 }) as never;
};

describe('runNotifyStage', () => {
  const originalKey = process.env.INTERNAL_SERVICE_KEY;
  const originalUrl = process.env.NOTIFICATION_INTERNAL_URL;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.INTERNAL_SERVICE_KEY;
    else process.env.INTERNAL_SERVICE_KEY = originalKey;

    if (originalUrl === undefined) delete process.env.NOTIFICATION_INTERNAL_URL;
    else process.env.NOTIFICATION_INTERNAL_URL = originalUrl;

    global.fetch = originalFetch;
  });

  describe('without a key', () => {
    beforeEach(() => delete process.env.INTERNAL_SERVICE_KEY);

    it('skips cleanly rather than failing', async () => {
      // The normal local and CI state: the pipeline is working as designed.
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as never;

      const result = await runNotifyStage(input());

      expect(result.outcome).toBe('SKIPPED');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('with a key', () => {
    beforeEach(() => {
      process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
      process.env.NOTIFICATION_INTERNAL_URL = 'http://notify.test';
      accepts();
    });

    it('posts to the internal events endpoint with the shared-secret header', async () => {
      await runNotifyStage(input());

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];

      expect(url).toBe('http://notify.test/notifications/events');
      expect(init.headers['X-Internal-Service-Key']).toBe('test-internal-key');
    });

    it('addresses the event to the dealer who owns the job', async () => {
      await runNotifyStage(input());

      expect(sentBody().userId).toBe(BASE.dealerId);
    });

    it('carries the counts the template needs', async () => {
      await runNotifyStage(input({ status: 'PARTIAL', validRecords: 34, invalidRecords: 6 }));

      expect(sentBody().payload).toMatchObject({
        jobId: BASE.jobId,
        fileName: 'stock.csv',
        status: 'PARTIAL',
        validRecords: 34,
        invalidRecords: 6,
      });
    });

    describe('event type', () => {
      it('sends UPLOAD_COMPLETED for a clean job', async () => {
        await runNotifyStage(input({ status: 'COMPLETED' }));

        expect(sentBody().type).toBe('UPLOAD_COMPLETED');
      });

      it('sends UPLOAD_COMPLETED for PARTIAL, not UPLOAD_FAILED', async () => {
        // A job that loaded 34 of 40 rows is far closer to completed than to
        // failed; the counts carry the nuance. UPLOAD_FAILED would tell that
        // dealer nothing worked.
        await runNotifyStage(input({ status: 'PARTIAL', validRecords: 34, invalidRecords: 6 }));

        expect(sentBody().type).toBe('UPLOAD_COMPLETED');
      });

      it('sends UPLOAD_FAILED only when nothing loaded', async () => {
        await runNotifyStage(input({ status: 'FAILED', validRecords: 0, invalidRecords: 40 }));

        expect(sentBody().type).toBe('UPLOAD_FAILED');
      });
    });

    describe('idempotency key', () => {
      it('is deterministic for a job and outcome', async () => {
        // notification-service dedupes on it, so a Step Functions retry
        // re-sends the same key rather than mailing the dealer twice.
        await runNotifyStage(input());
        const first = sentBody().idempotencyKey;

        accepts();
        await runNotifyStage(input());

        expect(sentBody().idempotencyKey).toBe(first);
      });

      it('differs between outcomes for the same job', async () => {
        await runNotifyStage(input({ status: 'COMPLETED' }));
        const completed = sentBody().idempotencyKey;

        accepts();
        await runNotifyStage(input({ status: 'FAILED' }));

        expect(sentBody().idempotencyKey).not.toBe(completed);
      });

      it('meets the 8-character minimum the DTO enforces', async () => {
        await runNotifyStage(input());

        expect(String(sentBody().idempotencyKey).length).toBeGreaterThanOrEqual(8);
      });
    });

    describe('the summary line', () => {
      it('says rows were skipped on PARTIAL', async () => {
        const result = await runNotifyStage(
          input({ status: 'PARTIAL', validRecords: 34, invalidRecords: 6 }),
        );

        const payload = sentBody().payload as { summary: string };
        expect(payload.summary).toMatch(/34 listings/);
        expect(payload.summary).toMatch(/6 rows were skipped/);
        expect(result.outcome).toBe('SUCCEEDED');
      });

      it('singularises a single row', async () => {
        await runNotifyStage(input({ status: 'PARTIAL', validRecords: 1, invalidRecords: 1 }));

        const payload = sentBody().payload as { summary: string };
        expect(payload.summary).toMatch(/1 listing /);
        expect(payload.summary).toMatch(/1 row was skipped/);
      });

      it('says nothing was created on FAILED', async () => {
        await runNotifyStage(input({ status: 'FAILED', validRecords: 0, invalidRecords: 40 }));

        const payload = sentBody().payload as { summary: string };
        expect(payload.summary).toMatch(/No listings were created/);
      });
    });

    describe('degradation', () => {
      it('degrades rather than throwing when the service is unreachable', async () => {
        // The rows are already written. Failing here would mark a successful
        // upload FAILED and invite the dealer to re-upload work that landed.
        global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;

        const result = await runNotifyStage(input());

        expect(result.outcome).toBe('DEGRADED');
        expect(result.error).toMatch(/ECONNREFUSED/);
      });

      it('degrades on a non-2xx response', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as never;

        const result = await runNotifyStage(input());

        expect(result.outcome).toBe('DEGRADED');
        expect(result.error).toMatch(/401/);
      });

      it('never rejects, whatever fetch does', async () => {
        global.fetch = jest.fn().mockRejectedValue('not even an Error') as never;

        await expect(runNotifyStage(input())).resolves.toMatchObject({ outcome: 'DEGRADED' });
      });
    });
  });
});
