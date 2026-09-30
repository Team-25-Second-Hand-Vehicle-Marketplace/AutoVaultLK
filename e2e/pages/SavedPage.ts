import { expect, type Page } from '@playwright/test';

export class SavedPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/saved');
  }

  async expectContains(makeModel: string): Promise<void> {
    await expect(this.page.getByRole('link', { name: new RegExp(makeModel, 'i') }).first()).toBeVisible();
  }
}
