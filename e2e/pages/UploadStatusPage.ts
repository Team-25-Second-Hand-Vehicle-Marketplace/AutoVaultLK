import { expect, type Page } from '@playwright/test';

export class UploadStatusPage {
  constructor(private readonly page: Page) {}

  statusLabel() {
    return this.page.locator('.upload-status__label');
  }

  /**
   * Waits for a terminal status label (Completed / Completed with skipped
   * rows / Failed), polling via Playwright's own retrying assertion rather
   * than the page's internal 2s-15s backoff timer - this only needs to
   * observe the end state, not replicate the frontend's poll cadence. The
   * pipeline runs in-process locally (no real Lambda/queue latency), but a
   * generous timeout keeps this robust under load.
   */
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
