import { expect, type Page } from '@playwright/test';

export class DealerProfilePage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/dealer/profile');
  }

  async updateCity(city: string): Promise<void> {
    const field = this.page.getByLabel('City');
    await field.fill('');
    await field.fill(city);
  }

  async save(): Promise<void> {
    await this.page.getByRole('button', { name: /save changes/i }).click();
  }

  async expectSaved(): Promise<void> {
    // sonner toast; asserted by text rather than role, since sonner renders
    // its own container without exposing an accessible role for this content.
    await expect(this.page.getByText('Your details have been updated.')).toBeVisible();
  }
}
