import { type BrowserContext, type Page } from '@playwright/test';

/**
 * Corrupts the stored session so the next authenticated request triggers
 * client.ts's real expiry path deterministically, without waiting out the
 * real 15m access-token TTL.
 *
 * Corrupting localStorage alone is not enough. auth-user-service's
 * POST /auth/refresh prefers a `refresh_token` cookie over the body field
 * (RefreshTokenCookieService.extractRefreshToken: `cookieToken ?? bodyToken`)
 * whenever AUTH_USE_REFRESH_COOKIES is true, which it is by default and in
 * this repo's local .env. login() sets that cookie (httpOnly: false, but
 * still browser-managed, not something client.ts ever reads or writes) in
 * addition to localStorage - so corrupting only localStorage.refreshToken
 * still lets the server silently refresh using the real cookie, and the
 * session recovers instead of expiring. Confirmed by direct observation:
 * with only localStorage corrupted, the request actually sent still carried
 * a freshly-issued, valid access token. The cookie must be cleared too for
 * the refresh call itself to fail.
 */
export async function corruptStoredSession(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem('autovault.accessToken', 'not-a-real-jwt');
    localStorage.setItem('autovault.refreshToken', 'not-a-real-refresh-token');
  });
  await context.clearCookies({ name: 'refresh_token' });
}

export async function hasStoredSession(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      localStorage.getItem('autovault.accessToken') !== null ||
      localStorage.getItem('autovault.refreshToken') !== null,
  );
}
