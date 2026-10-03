import { expect, type Page } from '@playwright/test';

export class BulkUploadPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/dealer/upload');
    // BulkUploadPage checks getActiveJob() on mount and redirects away if
    // one is already in flight - this waits past that transient "Checking
    // for an upload already in progress…" state before interacting.
    await expect(this.page.getByText('Checking for an upload already in progress')).toHaveCount(
      0,
      { timeout: 10_000 },
    );

    // The "How to prepare your upload" guide opens on a dealer's first visit
    // and its backdrop intercepts clicks on the form until it is closed.
    const guide = this.page.getByRole('dialog', { name: 'How to prepare your upload' });
    if (await guide.isVisible()) {
      await guide.getByRole('button', { name: 'Close' }).click();
      await expect(guide).toBeHidden();
    }
  }

  /** CSV is the default format, so no selection is needed first. */
  async chooseCsv(path: string): Promise<void> {
    await this.page.locator('input#file-input').setInputFiles(path);
  }

  async chooseJson(path: string): Promise<void> {
    await this.page.getByRole('radio', { name: 'JSON' }).check();
    await this.page.locator('input#file-input').setInputFiles(path);
  }

  async chooseZip(path: string): Promise<void> {
    await this.page.locator('input#zip-input').setInputFiles(path);
  }

  async uploadAndWaitForJob(): Promise<string> {
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/ingest/upload') && response.request().method() === 'POST',
    );
    await this.page.getByRole('button', { name: 'Upload inventory' }).click();
    await responsePromise;

    // BulkUploadPage navigates to /dealer/uploads/:jobId itself once the
    // upload response resolves - reading the id back off the URL avoids
    // parsing the response body a second time.
    await expect(this.page).toHaveURL(/\/dealer\/uploads\/[0-9a-f-]+$/);
    const match = this.page.url().match(/\/dealer\/uploads\/([0-9a-f-]+)$/);
    if (!match) throw new Error(`Could not read jobId from URL: ${this.page.url()}`);
    return match[1];
  }
}
