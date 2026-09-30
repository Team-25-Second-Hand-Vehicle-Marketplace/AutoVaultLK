import { expect, type Page } from '@playwright/test';

export class VerifyEmailPage {
  constructor(private readonly page: Page) {}

  async gotoWithToken(token: string): Promise<void> {
    await this.page.goto(`/verify-email?token=${encodeURIComponent(token)}`);
  }

  async expectVerified(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  }

  async expectFailed(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Verification failed' })).toBeVisible();
  }

  goToSignIn(): Promise<void> {
    return this.page.getByRole('link', { name: /go to sign in/i }).click();
  }
}
