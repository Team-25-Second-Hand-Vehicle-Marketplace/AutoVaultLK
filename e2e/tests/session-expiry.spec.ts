import { expect, test } from '@playwright/test';
import { corruptStoredSession, hasStoredSession } from '../helpers/session';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';


async function registerAndLoginBuyer(page: import('@playwright/test').Page) {
  const stamp = Date.now();
  const buyer = {
    name: 'Playwright Session Buyer',
    email: `playwright-session-${stamp}@example.test`,
    password: 'Passw0rd!23',
  };

  const registerPage = new RegisterPage(page);
  const verifyEmailPage = new VerifyEmailPage(page);
  const loginPage = new LoginPage(page);

  await registerPage.goto();
  const registerResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/auth/register/buyer') && response.request().method() === 'POST',
  );
  await registerPage.fillAndSubmit(buyer);
  const registerResponse = await registerResponsePromise;
  const { verificationToken } = (await registerResponse.json()) as {
    verificationToken?: string;
  };
  expect(verificationToken).toBeTruthy();

  await verifyEmailPage.gotoWithToken(verificationToken!);
  await verifyEmailPage.expectVerified();

  await loginPage.goto();
  await loginPage.login(buyer.email, buyer.password);
  await expect(page).toHaveURL(/\/search$/);

  return buyer;
}

test('an expired, unrecoverable session redirects to login and returns the buyer to their page on re-auth', async ({
  page,
  context,
}) => {
  const buyer = await registerAndLoginBuyer(page);

  expect(await hasStoredSession(page)).toBe(true);

  await corruptStoredSession(page, context);

  // /saved is RequireAuth-gated and calls GET /marketplace/favourites on
  // mount - the trigger for the interceptor's expiry path.
  await page.goto('/saved');

  await page.waitForURL(/\/login$/, { timeout: 15_000 });

  // clearSession() ran as part of the failed-refresh path.
  expect(await hasStoredSession(page)).toBe(false);

  // RequireAuth stashed the originally-requested path in location state;
  // LoginPage reads it and returns the user there after a successful
  // re-login, rather than defaulting to /search.
  const loginPage = new LoginPage(page);
  await loginPage.login(buyer.email, buyer.password);
  await expect(page).toHaveURL(/\/saved$/);
});
