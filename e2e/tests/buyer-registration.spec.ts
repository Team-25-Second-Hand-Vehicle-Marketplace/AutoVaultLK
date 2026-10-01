import { expect, test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';

/**
 * Buyer registration → email verification → first login.
 *
 * Local/dev never sends a real email (no SMTP/SES configured; see
 * VerificationEmailService's "[email skipped]" log line) - with
 * AUTH_RETURN_VERIFICATION_TOKEN=true (set in the repo's .env.example and
 * the real local .env), auth-user-service instead returns the raw
 * verification token directly in POST /auth/register/buyer's JSON body.
 * This is the same mechanism auth-user-service's own e2e harness
 * (registerAndVerifyBuyer in test/helpers/auth-e2e.harness.ts) relies on -
 * intercepting it here rather than adding a new backend affordance keeps
 * this test using only what already has to exist for the API-level suite.
 *
 * Without this flag there is no dev-mode way to retrieve the token (it is
 * stored SHA-256 hashed, not as the raw value, so no direct DB read
 * substitutes for it) - the test fails loudly rather than silently skipping,
 * since a missing flag means this journey cannot be exercised at all.
 */

function uniqueBuyer() {
  const stamp = Date.now();
  return {
    name: 'Playwright Buyer',
    email: `playwright-buyer-${stamp}@example.test`,
    password: 'Passw0rd!23',
  };
}

test('buyer can register, verify their email, and log in', async ({ page }) => {
  const buyer = uniqueBuyer();
  const registerPage = new RegisterPage(page);
  const verifyEmailPage = new VerifyEmailPage(page);
  const loginPage = new LoginPage(page);

  await registerPage.goto();

  const registerResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/auth/register/buyer') && response.request().method() === 'POST',
  );
  await registerPage.fillAndSubmit(buyer);
  const registerResponse = await registerResponsePromise;

  expect(registerResponse.ok()).toBe(true);
  const body = (await registerResponse.json()) as { verificationToken?: string };
  const verificationToken = body.verificationToken;

  expect(
    verificationToken,
    'POST /auth/register/buyer did not return verificationToken - ' +
      'is AUTH_RETURN_VERIFICATION_TOKEN=true set in the running auth-user-service?',
  ).toBeTruthy();

  await registerPage.expectVerificationNotice();

  await verifyEmailPage.gotoWithToken(verificationToken!);
  await verifyEmailPage.expectVerified();

  await verifyEmailPage.goToSignIn();
  await expect(page).toHaveURL(/\/login$/);

  await loginPage.login(buyer.email, buyer.password);
  await expect(page).toHaveURL(/\/search$/);
});

test('an unverified buyer cannot log in, and is offered a resend', async ({ page }) => {
  const buyer = uniqueBuyer();
  const registerPage = new RegisterPage(page);
  const loginPage = new LoginPage(page);

  await registerPage.goto();
  await registerPage.fillAndSubmit(buyer);
  await registerPage.expectVerificationNotice();

  await loginPage.goto();
  await loginPage.login(buyer.email, buyer.password);

  await expect(page.getByText(/verify your email/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /resend/i })).toBeVisible();
});
