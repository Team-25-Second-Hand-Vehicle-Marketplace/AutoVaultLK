import { expect, type Page } from '@playwright/test';

export class AdminDashboardPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/admin');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  }

  kpiValue(label: string) {
    return this.page.locator('.admin-kpi', { hasText: label }).locator('.admin-kpi__value');
  }

  /**
   * Scoped to the nav landmark, not just any link named "Users": the
   * "Total users" KPI tile is itself a link to /admin/users, so a bare
   * role-name lookup is ambiguous between the nav item and the tile.
   */
  async goToUsers(): Promise<void> {
    await this.page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Users' }).click();
  }

  async goToAuditLogs(): Promise<void> {
    await this.page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Audit logs' }).click();
  }
}
