
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

const MIN_REQUEST_INTERVAL_MS = 750;

/** Resolves once the process-wide pacing gate has cleared for the next caller. */
let pacingGate: Promise<void> = Promise.resolve();

/**
 * Serializes callers through MIN_REQUEST_INTERVAL_MS spacing, regardless of
 * how many are queued concurrently. Chained onto the existing gate rather
 * than tracked via a single "last call" timestamp so concurrent callers
 * queue in arrival order instead of racing to read/write shared state.
 */
function throttle(): Promise<void> {
  const wait = pacingGate.then(() => sleep(MIN_REQUEST_INTERVAL_MS));
  // Swallow rejections here so one caller's eventual failure (after this gate
  // resolves) can't poison the shared chain for callers queued behind it.
  pacingGate = wait.catch(() => undefined);
  return wait;
}

const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_BASE_DELAY_MS = 2000;

const TIMEOUT_MAX_ATTEMPTS = 2;
const TIMEOUT_DELAY_MS = 5000;

/**
 * One completion, retried under whichever policy matches the failure. A 400
 * means the request itself is wrong and retrying it just spends the timeout
 * again, so it is not retried at all.
 */
export async function complete(systemPrompt: string, userPayload: string): Promise<string> {
  if (!isGroqConfigured()) {
    throw new GroqUnavailableError('GROQ_API_KEY is not set');
  }

  let lastError: Error | undefined;
  let rateLimitAttempts = 0;
  let timeoutAttempts = 0;

  for (;;) {
    try {
      return await once(systemPrompt, userPayload);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (isRateLimited(err)) {
        rateLimitAttempts++;
        if (rateLimitAttempts >= RATE_LIMIT_MAX_ATTEMPTS) throw lastError;
        await sleep(rateLimitBackoff(rateLimitAttempts));
        continue;
      }

      if (isTimeout(err)) {
        timeoutAttempts++;
        if (timeoutAttempts >= TIMEOUT_MAX_ATTEMPTS) throw lastError;
        await sleep(TIMEOUT_DELAY_MS);
        continue;
      }

      throw lastError;
    }
  }
}

function rateLimitBackoff(attempt: number): number {
  return Math.random() * RATE_LIMIT_BASE_DELAY_MS * 2 ** (attempt - 1);
}

const MAX_COMPLETION_TOKENS = 2000;

const REASONING_EFFORT = 'low';

async function once(systemPrompt: string, userPayload: string): Promise<string> {
  await throttle();

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
      reasoning_effort: REASONING_EFFORT,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    // The body names the actual cause (json_validate_failed, an invalid
    // model name, a bad parameter) - a bare status code alone reads
    // identically for every one of those in etl_stage_logs.error_message,
    // which is what made this class of failure slow to diagnose. Guarded
    // for a response with no readable body at all, not just a rejected one.
    const detail =
      typeof response.text === 'function' ? await response.text().catch(() => '') : '';
    throw new GroqUnavailableError(
      `Groq HTTP ${response.status}${detail ? `: ${truncateDetail(detail)}` : ''}`,
      response.status,
    );
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

/** 429, plus 5xx - both are transient server-side conditions worth the longer backoff. */
function isRateLimited(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 429 || (status !== undefined && status >= 500);
}

/** The request-side abort/timeout path - a fixed, short retry, not backoff. */
function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Matches ingestion.etl_stage_logs.error_message's practical display width. */
const MAX_ERROR_DETAIL_LENGTH = 300;

function truncateDetail(detail: string): string {
  const oneLine = detail.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_ERROR_DETAIL_LENGTH
    ? `${oneLine.slice(0, MAX_ERROR_DETAIL_LENGTH - 1)}…`
    : oneLine;
}
