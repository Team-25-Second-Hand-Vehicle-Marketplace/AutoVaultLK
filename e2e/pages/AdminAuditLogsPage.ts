import { expect, type Page } from '@playwright/test';

export class AdminAuditLogsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/admin/audit-logs');
  }

  /** AuditLogsRepository.search does `a.action = :action` - an exact match, not a substring. */
  async searchByAction(action: string): Promise<void> {
    await this.page.getByLabel('Action').fill(action);
    await this.page.getByRole('button', { name: 'Search' }).click();
  }

  async expectRowForEntity(entityId: string): Promise<void> {
    await expect(
      this.page.getByRole('row', { name: new RegExp(entityId.slice(0, 8)) }),
    ).toBeVisible();
  }
}
