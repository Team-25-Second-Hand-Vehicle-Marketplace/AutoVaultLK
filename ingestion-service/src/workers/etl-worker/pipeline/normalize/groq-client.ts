/**
 * Minimal Groq client for the normalization fallback.
 *
 * Deliberately NOT the @Injectable one from
 * marketplace-service/src/modules/search/groq/groq-client.ts: stages may not
 * import NestJS (see pipeline/types.ts), so this reads process.env directly —
 * the same way groq-normalize.stage.ts already checks for the key. The request
 * shape, the retry rule and the fence-stripping parser are copied from there,
 * because both halves of the platform should fail the same way.
 */

const DEFAULT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-20b';

/**
 * Longer than search's 1500ms. A buyer waiting on a query needs an answer now;
 * a batch of dealer rows is already asynchronous, and a timeout here costs the
 * whole batch its enrichment rather than one person their result.
 */
const DEFAULT_TIMEOUT_MS = 8000;

export class GroqUnavailableError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GroqUnavailableError';
    this.status = status;
  }
}

export function isGroqConfigured(): boolean {
  return (process.env.GROQ_API_KEY ?? '').trim().length > 0;
}

/**
 * One completion, with a single retry on the failures worth retrying.
 *
 * 429 and 5xx are transient; a 400 means the request itself is wrong and
 * retrying it just spends the timeout twice.
 */
export async function complete(systemPrompt: string, userPayload: string): Promise<string> {
  if (!isGroqConfigured()) {
    throw new GroqUnavailableError('GROQ_API_KEY is not set');
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await once(systemPrompt, userPayload);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!isRetryable(err) || attempt === 1) throw lastError;
      await sleep(300);
    }
  }

  throw lastError ?? new GroqUnavailableError('Groq call failed');
}

async function once(systemPrompt: string, userPayload: string): Promise<string> {
  const url = process.env.GROQ_API_URL || DEFAULT_URL;
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const timeoutMs = Number(process.env.GROQ_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${(process.env.GROQ_API_KEY ?? '').trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      // Zero temperature: the same dirty cell must normalize the same way on
      // every run, or a re-upload silently changes a dealer's inventory.
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new GroqUnavailableError(`Groq HTTP ${response.status}`, response.status);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new GroqUnavailableError('Groq returned an empty completion');

  return content;
}

/**
 * Models wrap JSON in markdown fences despite response_format, and sometimes
 * add a sentence before it. Take the outermost braces rather than trusting the
 * whole string to parse.
 */
export function parseGroqJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : trimmed;

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new GroqUnavailableError('Groq response was not JSON');
  }

  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === 429 || (status !== undefined && status >= 500)) return true;

  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
