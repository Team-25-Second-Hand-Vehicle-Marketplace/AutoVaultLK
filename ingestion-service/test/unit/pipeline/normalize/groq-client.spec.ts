import { complete, isGroqConfigured } from '../../../../src/workers/etl-worker/pipeline/normalize/groq-client';

/**
 * These tests exercise real retry delays (up to ~5s for the timeout policy,
 * and up to ~2+4+8+16s worst-case for the rate-limit policy) rather than
 * fake timers — jest's fake timers do not reliably interleave with a
 * fetch mock's own promise microtasks here, and the real delays are short
 * enough to run in CI without mocking them away.
 */
jest.setTimeout(60_000);

function timeoutError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'TimeoutError';
  return err;
}

describe('groq-client', () => {
  const originalKey = process.env.GROQ_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
    global.fetch = originalFetch;
  });

  const okResponse = (content = '{"rows":[]}') => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  it('reports unconfigured when GROQ_API_KEY is unset', () => {
    delete process.env.GROQ_API_KEY;
    expect(isGroqConfigured()).toBe(false);
  });

  describe('rate limit (429) policy', () => {
    it('retries up to 5 total attempts with exponential backoff', async () => {
      const fetchSpy = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce(okResponse());
      global.fetch = fetchSpy as never;

      const result = await complete('system', 'user');

      expect(fetchSpy).toHaveBeenCalledTimes(5);
      expect(result).toBe('{"rows":[]}');
    });

    it('gives up after 5 attempts and throws', async () => {
      const fetchSpy = jest.fn().mockResolvedValue({ ok: false, status: 429 });
      global.fetch = fetchSpy as never;

      await expect(complete('system', 'user')).rejects.toThrow(/HTTP 429/);
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    });

    it('treats a 5xx the same as a 429', async () => {
      const fetchSpy = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce(okResponse());
      global.fetch = fetchSpy as never;

      await complete('system', 'user');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('timeout policy', () => {
    it('retries up to 2 total attempts with a fixed interval, distinct from the rate-limit policy', async () => {
      const fetchSpy = jest
        .fn()
        .mockRejectedValueOnce(timeoutError())
        .mockResolvedValueOnce(okResponse());
      global.fetch = fetchSpy as never;

      await complete('system', 'user');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('gives up after 2 attempts on repeated timeouts', async () => {
      const fetchSpy = jest.fn().mockRejectedValue(timeoutError());
      global.fetch = fetchSpy as never;

      await expect(complete('system', 'user')).rejects.toThrow();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('does not retry a non-retryable client error', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: false, status: 400 });
    global.fetch = fetchSpy as never;

    await expect(complete('system', 'user')).rejects.toThrow(/HTTP 400/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws when GROQ_API_KEY is not set', async () => {
    delete process.env.GROQ_API_KEY;

    await expect(complete('system', 'user')).rejects.toThrow(/GROQ_API_KEY/);
  });
});
