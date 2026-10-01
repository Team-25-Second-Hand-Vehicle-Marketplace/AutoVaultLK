import { expect, type Page } from '@playwright/test';

export class AdminUsersPage {
  constructor(private readonly page: Page) {}

  async gotoPendingTab(): Promise<void> {
    await this.page.goto('/admin/users?tab=pending');
  }

  rowFor(email: string) {
    return this.page.getByRole('row', { name: new RegExp(email) });
  }

  async approve(email: string): Promise<void> {
    await this.rowFor(email).getByRole('button', { name: 'Approve' }).click();
    await expect(this.page.getByText('Dealer approved')).toBeVisible();
  }

  async expectRowGone(email: string): Promise<void> {
    // AdminUsersPage.load() re-fetches after the mutation, so on the
    // "pending" tab the approved dealer's row disappears without a manual
    // reload - this is the assertion that catches a regression there.
    await expect(this.rowFor(email)).toHaveCount(0);
  }
}
