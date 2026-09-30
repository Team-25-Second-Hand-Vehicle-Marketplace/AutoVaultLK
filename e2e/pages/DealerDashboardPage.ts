import { expect, type Page } from '@playwright/test';

export class DealerDashboardPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/dealer');
  }

  async expectPendingBanner(): Promise<void> {
    await expect(this.page.getByText('Verification pending')).toBeVisible();
  }

  async expectVerifiedDashboard(): Promise<void> {
    await expect(this.page.getByText('Verified dealer')).toBeVisible();
  }
}
