import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

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
 * FR-51 / SAD 3.6.3. Locally neither SES_FROM_EMAIL nor SMTP_HOST is set →
 * log and succeed (same skip as Groq).
 *
 * Two transports behind one interface: when SMTP_HOST is set, mail goes out
 * over SMTP (nodemailer) — this needs no SES sandbox exit or verified domain.
 * Otherwise it uses SES. The name is historical; the retry/idempotency logic
 * in NotificationEventHandler is transport-independent.
 */
@Injectable()
export class SesAdapter {
  private readonly logger = new Logger(SesAdapter.name);
  private smtp?: Transporter;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return this.useSmtp() || this.sesFrom().length > 0;
  }

  private useSmtp(): boolean {
    return (this.config.get<string>('SMTP_HOST') ?? '').trim().length > 0;
  }

  private sesFrom(): string {
    return (this.config.get<string>('SES_FROM_EMAIL') ?? '').trim();
  }

  private smtpFrom(): string {
    return (
      (this.config.get<string>('SMTP_FROM') ?? '').trim() ||
      this.sesFrom() ||
      (this.config.get<string>('SMTP_USER') ?? '').trim()
    );
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
    if (this.useSmtp()) {
      await this.viaSmtp(to, subject, body);
      return;
    }
    await this.viaSes(to, subject, body);
  }

  private async viaSmtp(to: string, subject: string, body: string): Promise<void> {
    const timeoutMs = Number(this.config.get('SES_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);

    try {
      this.smtp ??= createTransport({
        host: (this.config.get<string>('SMTP_HOST') ?? '').trim(),
        port: Number(this.config.get('SMTP_PORT') ?? 587),
        // 465 is implicit TLS; 587 upgrades with STARTTLS (required, never plaintext).
        secure: Number(this.config.get('SMTP_PORT') ?? 587) === 465,
        requireTLS: true,
        auth: this.config.get<string>('SMTP_USER')
          ? {
              user: this.config.get<string>('SMTP_USER'),
              pass: this.config.get<string>('SMTP_PASS'),
            }
          : undefined,
        connectionTimeout: timeoutMs,
        greetingTimeout: timeoutMs,
        socketTimeout: timeoutMs,
      });

      await this.smtp.sendMail({ from: this.smtpFrom(), to, subject, text: body });
    } catch (err) {
      throw toSmtpError(err);
    }
  }

  private async viaSes(to: string, subject: string, body: string): Promise<void> {
    const from = this.sesFrom();
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

/**
 * Maps nodemailer failures onto the adapter's HTTP-shaped retry contract:
 * SMTP 4xx replies and connection-level errors are transient (retryable,
 * 503); 5xx replies (bad auth, rejected recipient) are permanent (400).
 */
function toSmtpError(err: unknown): SesUnavailableError {
  const e = err as { message?: string; code?: string; responseCode?: number };
  const message = `SMTP: ${e?.message ?? 'send failed'}`;

  if (typeof e?.responseCode === 'number') {
    return new SesUnavailableError(message, e.responseCode >= 500 ? 400 : 503);
  }
  // No SMTP reply at all: ETIMEDOUT / ECONNECTION / ESOCKET / DNS — transient.
  return new SesUnavailableError(message, 503);
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
