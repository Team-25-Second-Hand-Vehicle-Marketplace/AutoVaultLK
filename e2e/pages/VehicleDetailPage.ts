import { expect, type Page } from '@playwright/test';

export class VehicleDetailPage {
  constructor(private readonly page: Page) {}

  async expectLoaded(): Promise<void> {
    await expect(this.page.locator('.detail-summary__header h1')).toBeVisible();
  }

  /**
   * Scoped to .detail-summary, not just any "Save this listing" button on
   * the page: RecommendationsSection below the fold renders its own
   * VehicleCards, each with their own SaveButton, so a bare role-name
   * lookup is ambiguous the moment recommendations are present.
   */
  saveButton() {
    return this.page.locator('.detail-summary').getByRole('button', { name: 'Save this listing' });
  }

  savedButton() {
    return this.page.locator('.detail-summary').getByRole('button', { name: 'Remove from saved' });
  }

  async save(): Promise<void> {
    await this.saveButton().click();
    await expect(this.savedButton()).toBeVisible();
  }

  async titleText(): Promise<string> {
    return (await this.page.locator('.detail-summary__header h1').textContent()) ?? '';
  }
}
