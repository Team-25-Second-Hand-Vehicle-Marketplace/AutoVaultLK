import { type BrowserContext, type Page } from '@playwright/test';

export async function corruptStoredSession(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem('autovault.accessToken', 'not-a-real-jwt');
  });
  await context.clearCookies({ name: 'refresh_token' });
}

export async function hasStoredSession(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      localStorage.getItem('autovault.accessToken') !== null ||
      localStorage.getItem('autovault.hasSession') !== null ||
      localStorage.getItem('autovault.user') !== null,
  );
}
