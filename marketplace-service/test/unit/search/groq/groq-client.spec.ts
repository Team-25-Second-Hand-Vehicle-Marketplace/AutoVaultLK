import { ConfigService } from '@nestjs/config';
import {
  GroqClient,
  GroqUnavailableError,
  parseGroqJson,
} from '../../../../src/modules/search/groq/groq-client';

function createConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    GROQ_API_KEY: 'test-key',
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe('GroqClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('isConfigured', () => {
    it('is false when GROQ_API_KEY is unset', () => {
      const client = new GroqClient(createConfig({ GROQ_API_KEY: undefined }));
      expect(client.isConfigured()).toBe(false);
    });

    it('is false when GROQ_API_KEY is only whitespace', () => {
      const client = new GroqClient(createConfig({ GROQ_API_KEY: '   ' }));
      expect(client.isConfigured()).toBe(false);
    });

    it('is true when GROQ_API_KEY is set', () => {
      const client = new GroqClient(createConfig());
      expect(client.isConfigured()).toBe(true);
    });
  });

  describe('complete', () => {
    it('throws GroqUnavailableError immediately when not configured, without calling fetch', async () => {
      global.fetch = jest.fn();
      const client = new GroqClient(createConfig({ GROQ_API_KEY: '' }));

      await expect(client.complete('sys', 'user')).rejects.toThrow(GroqUnavailableError);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns the completion content on a successful call', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse({ choices: [{ message: { content: '{"make":"Toyota"}' } }] }));
      const client = new GroqClient(createConfig());

      await expect(client.complete('sys', 'user')).resolves.toBe('{"make":"Toyota"}');
    });

    it('sends the API key as a Bearer token and the prompts as chat messages', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse({ choices: [{ message: { content: '{}' } }] }));
      const client = new GroqClient(createConfig());

      await client.complete('system-prompt', 'user-payload');

      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer test-key');
      const body = JSON.parse(init.body);
      expect(body.messages).toEqual([
        { role: 'system', content: 'system-prompt' },
        { role: 'user', content: 'user-payload' },
      ]);
    });

    it('retries once on a 503 and succeeds on the second attempt', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, false, 503))
        .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{}' } }] }));
      const client = new GroqClient(createConfig());

      await expect(client.complete('sys', 'user')).resolves.toBe('{}');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry a non-retryable 400 and throws immediately', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, false, 400));
      const client = new GroqClient(createConfig());

      await expect(client.complete('sys', 'user')).rejects.toThrow('Groq HTTP 400');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('gives up after exhausting the one retry on repeated 503s', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, false, 503));
      const client = new GroqClient(createConfig());

      await expect(client.complete('sys', 'user')).rejects.toThrow('Groq HTTP 503');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws when the response has no completion content', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ choices: [] }));
      const client = new GroqClient(createConfig());

      await expect(client.complete('sys', 'user')).rejects.toThrow('Groq returned an empty completion');
    });
  });

  describe('parseGroqJson', () => {
    it('parses a plain JSON object', () => {
      expect(parseGroqJson('{"make":"Toyota"}')).toEqual({ make: 'Toyota' });
    });

    it('extracts JSON from a fenced ```json code block', () => {
      expect(parseGroqJson('```json\n{"make":"Toyota"}\n```')).toEqual({ make: 'Toyota' });
    });

    it('extracts JSON from a fenced code block with no language tag', () => {
      expect(parseGroqJson('```\n{"make":"Honda"}\n```')).toEqual({ make: 'Honda' });
    });

    it('extracts a JSON object surrounded by prose', () => {
      expect(parseGroqJson('Sure, here you go: {"make":"Nissan"} — hope that helps!')).toEqual({
        make: 'Nissan',
      });
    });

    it('throws GroqUnavailableError when no JSON object is present', () => {
      expect(() => parseGroqJson('not json at all')).toThrow(GroqUnavailableError);
    });
  });
});
