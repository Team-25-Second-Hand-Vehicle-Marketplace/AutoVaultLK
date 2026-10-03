import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { createTransport, type Transporter } from 'nodemailer';

const DEFAULT_TIMEOUT_MS = 10000;
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
    const link = this.buildLink('verify-email', rawToken);
    return this.deliver(
      to,
      'Verify your AutoVault LK email address',
      this.textBody(link),
      this.htmlBody(link),
    );
  }

  async sendPasswordReset(to: string, rawToken: string): Promise<boolean> {
    const link = this.buildLink('reset-password', rawToken);
    return this.deliver(
      to,
      'Reset your AutoVault LK password',
      this.resetTextBody(link),
      this.resetHtmlBody(link),
    );
  }

  private async deliver(
    to: string,
    subject: string,
    text: string,
    html: string,
  ): Promise<boolean> {
    const smtp = this.useSmtp();
    const from = smtp ? this.smtpFrom() : this.fromAddress();
    if (!from) {
      this.logger.log(`[email skipped] "${subject}" to=${to}`);
      return false;
    }

    const message = { from, to, subject, text, html };

    try {
      if (smtp) {
        await this.sendViaSmtp(message);
      } else {
        await this.sendViaSes(message);
      }
      return true;
    } catch (err) {
      // The token is in the link inside text/html - never log them.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Email "${subject}" to ${to} failed: ${reason}`);
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

  private buildLink(path: string, rawToken: string): string {
    const base = (
      this.config.get<string>('FRONTEND_URL') ?? DEFAULT_FRONTEND_URL
    )
      .trim()
      .replace(/\/+$/, '');
    return `${base}/${path}?token=${encodeURIComponent(rawToken)}`;
  }

  private resetTextBody(link: string): string {
    return [
      'We received a request to reset your AutoVault LK password.',
      '',
      'Open this link to choose a new password:',
      link,
      '',
      'This link expires after a limited time. If you did not ask for a reset, ignore this email - your password will not change.',
    ].join('\n');
  }

  private resetHtmlBody(link: string): string {
    return `<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background-color:#f1f5f9; font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
            <tr>
              <td style="background-color:#1d4ed8; padding:24px 32px;">
                <span style="color:#ffffff; font-size:20px; font-weight:700;">AutoVault LK</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px; color:#0f172a; font-size:20px; font-weight:700;">Reset your password</h1>
                <p style="margin:0 0 24px; color:#334155; font-size:15px; line-height:1.6;">
                  We received a request to reset your password. Choose a new one using the button below.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:8px; background-color:#3b82f6;">
                      <a href="${link}" style="display:inline-block; padding:12px 28px; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none;">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0; color:#64748b; font-size:13px; line-height:1.6;">
                  If you did not ask for a reset, ignore this email - your password will not change.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
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

  /**
   * Table-based layout with every style inline: Gmail, Outlook and most
   * mobile mail clients strip <style> blocks and collapse non-table layout,
   * so this is the only markup style that renders consistently across them.
   * Colors match the web app's accent blue (web-frontend/src/styles/next.css).
   */
  private htmlBody(link: string): string {
    return `<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background-color:#f1f5f9; font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
            <tr>
              <td style="background-color:#1d4ed8; padding:24px 32px;">
                <span style="color:#ffffff; font-size:20px; font-weight:700; letter-spacing:-0.01em;">AutoVault LK</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px; color:#0f172a; font-size:20px; font-weight:700;">Verify your email address</h1>
                <p style="margin:0 0 24px; color:#334155; font-size:15px; line-height:1.6;">
                  Welcome to AutoVault LK. Confirm this is your email address to activate your account.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:8px; background-color:#3b82f6;">
                      <a href="${link}" style="display:inline-block; padding:12px 28px; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none;">
                        Verify email address
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0; color:#64748b; font-size:13px; line-height:1.6;">
                  If the button doesn't work, copy and paste this link into your browser:<br>
                  <a href="${link}" style="color:#1d4ed8; word-break:break-all;">${link}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#f8fafc; border-top:1px solid #e2e8f0;">
                <p style="margin:0; color:#94a3b8; font-size:12px; line-height:1.6;">
                  This link expires after a limited time. If you didn't create an AutoVault LK account, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
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
