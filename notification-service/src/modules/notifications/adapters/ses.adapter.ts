import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_TIMEOUT_MS = 5000;

export class SesUnavailableError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SesUnavailableError';
    this.status = status;
  }
}

/**
 * FR-51 / SAD 3.6.3. Locally SES_FROM_EMAIL is empty → log and succeed
 * (same skip as Groq). Production sets the from-address and AWS credentials.
 */
@Injectable()
export class SesAdapter {
  private readonly logger = new Logger(SesAdapter.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return (this.config.get<string>('SES_FROM_EMAIL') ?? '').trim().length > 0;
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.log(`[SES skipped] to=${to} subject=${subject}`);
      return;
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.once(to, subject, body);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!isRetryable(err) || attempt === 1) throw lastError;
        this.logger.warn(`SES attempt ${attempt + 1} failed (${lastError.message}); retrying`);
        await sleep(200 * (attempt + 1));
      }
    }
    throw lastError ?? new SesUnavailableError('SES send failed');
  }

  private async once(to: string, subject: string, body: string): Promise<void> {
    const from = this.config.get<string>('SES_FROM_EMAIL')!.trim();
    const region = this.config.get<string>('AWS_REGION') ?? 'ap-southeast-1';
    const timeoutMs = Number(this.config.get('SES_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);

    let SESv2Client: typeof import('@aws-sdk/client-sesv2').SESv2Client;
    let SendEmailCommand: typeof import('@aws-sdk/client-sesv2').SendEmailCommand;
    try {
      ({ SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2'));
    } catch {
      throw new SesUnavailableError('@aws-sdk/client-sesv2 is not installed');
    }

    const client = new SESv2Client({ region, requestHandler: undefined });
    const command = new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      },
    });

    try {
      await Promise.race([
        client.send(command),
        sleep(timeoutMs).then(() => {
          throw new SesUnavailableError('SES timed out');
        }),
      ]);
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      throw new SesUnavailableError(
        err instanceof Error ? err.message : 'SES send failed',
        status,
      );
    }
  }
}

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number }).status;
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return true;
  }
  if (err instanceof SesUnavailableError && err.message.includes('timed out')) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
