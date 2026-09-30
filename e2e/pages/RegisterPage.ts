import { expect, type Page } from '@playwright/test';

export class RegisterPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/register');
  }

  async fillAndSubmit(values: {
    name: string;
    email: string;
    password: string;
  }): Promise<void> {
    await this.page.getByLabel('Full name').fill(values.name);
    await this.page.getByLabel('Email').fill(values.email);
    await this.page.getByLabel('Password', { exact: true }).fill(values.password);
    await this.page.getByLabel('Confirm password').fill(values.password);
    await this.page.getByRole('button', { name: /create account/i }).click();
  }

  async expectVerificationNotice(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Almost there' })).toBeVisible();
    await expect(this.page.getByRole('status')).toBeVisible();
  }
}
