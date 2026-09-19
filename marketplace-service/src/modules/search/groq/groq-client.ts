import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const DEFAULT_TIMEOUT_MS = 1500;

export class GroqUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroqUnavailableError';
  }
}

@Injectable()
export class GroqClient {
  private readonly logger = new Logger(GroqClient.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return (this.config.get<string>('GROQ_API_KEY') ?? '').trim().length > 0;
  }

  async complete(systemPrompt: string, userPayload: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new GroqUnavailableError('GROQ_API_KEY is not set');
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.once(systemPrompt, userPayload);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!isRetryable(err) || attempt === 1) throw lastError;
        this.logger.warn(`Groq attempt ${attempt + 1} failed (${lastError.message}); retrying`);
        await sleep(200 * (attempt + 1));
      }
    }
    throw lastError ?? new GroqUnavailableError('Groq call failed');
  }

  private async once(systemPrompt: string, userPayload: string): Promise<string> {
    const url = this.config.get<string>('GROQ_API_URL') || DEFAULT_URL;
    const model = this.config.get<string>('GROQ_MODEL') || DEFAULT_MODEL;
    const timeoutMs = Number(this.config.get('GROQ_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
    const apiKey = this.config.get<string>('GROQ_API_KEY')!.trim();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
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
      const err = new GroqUnavailableError(`Groq HTTP ${response.status}`);
      (err as GroqUnavailableError & { status?: number }).status = response.status;
      throw err;
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new GroqUnavailableError('Groq returned an empty completion');
    return content;
  }
}

export function parseGroqJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new GroqUnavailableError('Groq response was not JSON');
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number }).status;
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
