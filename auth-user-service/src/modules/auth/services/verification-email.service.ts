import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { createTransport, type Transporter } from 'nodemailer';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

type Message = { from: string; to: string; subject: string; text: string; html: string };

/**
 * Emails the account-verification link.
 *
 * Deliberately never throws: a mail outage must not fail registration or the
 * resend endpoint (the user can request another email), and both callers'
 * responses must look the same whether or not delivery worked. Callers get
 * `false` and a log line instead.
 *
 * Two transports, same as notification-service's SesAdapter: SMTP when
 * SMTP_HOST is set (no SES sandbox exit or verified domain needed),
 * otherwise SES. With neither configured (local dev, CI) nothing is sent. The Lambda must await send():
 * the runtime freezes as soon as the response returns, so a fire-and-forget
 * promise would usually never complete.
 */
@Injectable()
export class VerificationEmailService {
  private readonly logger = new Logger(VerificationEmailService.name);
  private client?: SESv2Client;
  private smtp?: Transporter;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return this.useSmtp() || this.fromAddress().length > 0;
  }

  async send(to: string, rawToken: string): Promise<boolean> {
    const smtp = this.useSmtp();
    const from = smtp ? this.smtpFrom() : this.fromAddress();
    if (!from) {
      this.logger.log(`[email skipped] verification email to=${to}`);
      return false;
    }

    const link = this.buildLink(rawToken);
    const message = {
      from,
      to,
      subject: 'Verify your AutoVault LK email address',
      text: this.textBody(link),
      html: this.htmlBody(link),
    };

    try {
      if (smtp) {
        await this.sendViaSmtp(message);
      } else {
        await this.sendViaSes(message);
      }
      return true;
    } catch (err) {
      // The token is in `link` — never log it.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Verification email to ${to} failed: ${reason}`);
      return false;
    }
  }

  private async sendViaSes(m: Message): Promise<void> {
    await this.getClient().send(
      new SendEmailCommand({
        FromEmailAddress: m.from,
        Destination: { ToAddresses: [m.to] },
        Content: {
          Simple: {
            Subject: { Data: m.subject },
            Body: { Text: { Data: m.text }, Html: { Data: m.html } },
          },
        },
      }),
      { abortSignal: AbortSignal.timeout(this.timeoutMs()) },
    );
  }

  private async sendViaSmtp(m: Message): Promise<void> {
    const port = Number(this.config.get('SMTP_PORT') ?? 587);
    const timeoutMs = this.timeoutMs();
    const user = this.config.get<string>('SMTP_USER');

    this.smtp ??= createTransport({
      host: (this.config.get<string>('SMTP_HOST') ?? '').trim(),
      port,
      // 465 is implicit TLS; 587 upgrades with STARTTLS (required, never plaintext).
      secure: port === 465,
      requireTLS: true,
      auth: user ? { user, pass: this.config.get<string>('SMTP_PASS') } : undefined,
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
    });

    await this.smtp.sendMail(m);
  }

  private useSmtp(): boolean {
    return (this.config.get<string>('SMTP_HOST') ?? '').trim().length > 0;
  }

  private smtpFrom(): string {
    return (
      (this.config.get<string>('SMTP_FROM') ?? '').trim() ||
      this.fromAddress() ||
      (this.config.get<string>('SMTP_USER') ?? '').trim()
    );
  }

  private timeoutMs(): number {
    return Number(this.config.get('SES_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
  }

  private buildLink(rawToken: string): string {
    const base = (
      this.config.get<string>('FRONTEND_URL') ?? DEFAULT_FRONTEND_URL
    )
      .trim()
      .replace(/\/+$/, '');
    return `${base}/verify-email?token=${encodeURIComponent(rawToken)}`;
  }

  private textBody(link: string): string {
    return [
      'Welcome to AutoVault LK.',
      '',
      'Please verify your email address by opening this link:',
      link,
      '',
      'This link expires after a limited time. If you did not create an account, you can ignore this email.',
    ].join('\n');
  }

  private htmlBody(link: string): string {
    return (
      '<p>Welcome to AutoVault LK.</p>' +
      `<p><a href="${link}">Verify your email address</a></p>` +
      `<p>If the button does not work, copy this link into your browser:<br>${link}</p>` +
      '<p>This link expires after a limited time. If you did not create an account, you can ignore this email.</p>'
    );
  }

  private fromAddress(): string {
    return (this.config.get<string>('SES_FROM_EMAIL') ?? '').trim();
  }

  private getClient(): SESv2Client {
    // Cached across warm invocations. AWS_REGION is set by the Lambda runtime.
    this.client ??= new SESv2Client({
      region: this.config.get<string>('AWS_REGION') ?? 'ap-southeast-2',
    });
    return this.client;
  }
}
