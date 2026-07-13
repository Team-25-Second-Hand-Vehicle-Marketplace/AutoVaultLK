import { expect, type Page } from '@playwright/test';

export class UploadStatusPage {
  constructor(private readonly page: Page) {}

  statusLabel() {
    return this.page.locator('.upload-status__label');
  }

  async waitForTerminalStatus(timeout = 60_000): Promise<string> {
    await expect(this.statusLabel()).toHaveText(
      /Completed|Completed with skipped rows|Failed/,
      { timeout },
    );
    return (await this.statusLabel().textContent()) ?? '';
  }

  tileValue(label: string) {
    return this.page
      .locator('.dealer-tiles__item', { hasText: label })
      .locator('.dealer-tiles__value');
  }

  rejectionsSection() {
    return this.page.locator('section.upload-card', { hasText: 'Rows that were skipped' });
  }

  rejectionRow(rowNumber: number | 'Whole file') {
    return this.rejectionsSection()
      .locator('tbody tr')
      .filter({ has: this.page.locator(`th:text-is("${rowNumber}")`) });
  }
}
