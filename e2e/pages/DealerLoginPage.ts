import { type Page } from '@playwright/test';

export class DealerLoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/dealer/login');
  }

  async login(email: string, password: string): Promise<void> {
    await this.page.getByLabel('Email Address').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: /sign in/i }).click();
  }
}
