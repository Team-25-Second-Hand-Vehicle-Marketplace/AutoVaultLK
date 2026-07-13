import { expect, test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';


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
