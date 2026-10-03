import { expect, test } from '@playwright/test';
import { approveDealer } from '../helpers/admin-api';
import { DealerDashboardPage } from '../pages/DealerDashboardPage';
import { DealerLoginPage } from '../pages/DealerLoginPage';
import { DealerProfilePage } from '../pages/DealerProfilePage';
import { DealerRegisterPage } from '../pages/DealerRegisterPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';


function uniqueDealer() {
  const stamp = Date.now();
  return {
    companyName: `Playwright Motors ${stamp}`,
    businessAddress: '123 Galle Road',
    city: 'Colombo',
    nicNumber: '991234567V',
    contactName: 'Playwright Dealer',
    contactNumber: '701234567',
    email: `playwright-dealer-${stamp}@example.test`,
    password: 'Passw0rd!23',
  };
}

test('dealer can register, verify email, sign in while pending, and get approved', async ({
  page,
  request,
  baseURL,
}) => {
  const dealer = uniqueDealer();
  const registerPage = new DealerRegisterPage(page);
  const verifyEmailPage = new VerifyEmailPage(page);
  const loginPage = new DealerLoginPage(page);
  const dashboardPage = new DealerDashboardPage(page);
  const profilePage = new DealerProfilePage(page);

  await registerPage.goto();
  await registerPage.fillCompanyInfoIndividual({
    companyName: dealer.companyName,
    businessAddress: dealer.businessAddress,
    city: dealer.city,
    nicNumber: dealer.nicNumber,
  });
  await registerPage.continueStep('Contact Details');

  await registerPage.fillContactDetails({
    name: dealer.contactName,
    contactNumber: dealer.contactNumber,
  });
  await registerPage.continueStep('Account Setup');

  await registerPage.fillAccountSetup({ email: dealer.email, password: dealer.password });
  await registerPage.continueStep('Review');

  const registerResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/auth/register/dealer') &&
      response.request().method() === 'POST',
  );
  await registerPage.submit();
  const registerResponse = await registerResponsePromise;

  expect(registerResponse.ok()).toBe(true);
  const body = (await registerResponse.json()) as {
    verificationToken?: string;
    user?: { id: string };
  };
  expect(body.verificationToken, 'AUTH_RETURN_VERIFICATION_TOKEN must be true for this test').toBeTruthy();
  expect(body.user?.id).toBeTruthy();
  const dealerUserId = body.user!.id;

  await registerPage.expectVerificationNotice();

  await verifyEmailPage.gotoWithToken(body.verificationToken!);
  await verifyEmailPage.expectVerified();
  // Corrected copy: confirms sign-in is offered immediately, not gated on
  // approval - this is the assertion that would have caught the stale text.
  await expect(page.getByText(/you can sign in now/i)).toBeVisible();

  await verifyEmailPage.goToSignIn();
  await expect(page).toHaveURL(/\/dealer\/login$/);

  await loginPage.login(dealer.email, dealer.password);
  await expect(page).toHaveURL(/\/dealer$/);
  await dashboardPage.expectPendingBanner();

  await approveDealer(request, baseURL!, dealerUserId);

  await dashboardPage.goto();
  await dashboardPage.expectVerifiedDashboard();

  await profilePage.goto();
  await profilePage.updateCity('Kandy');
  await profilePage.save();
  await profilePage.expectSaved();
});
