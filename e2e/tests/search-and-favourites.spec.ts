import { expect, test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { SavedPage } from '../pages/SavedPage';
import { SearchPage } from '../pages/SearchPage';
import { VehicleDetailPage } from '../pages/VehicleDetailPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';

/**
 * Filtered search → vehicle detail → save as favourite → confirmed on the
 * saved-vehicles page.
 *
 * Uses filtered search (a direct /search?... URL) rather than the
 * HeroSearch NL box: NL search runs through Groq when GROQ_API_KEY is set,
 * or the deterministic parser otherwise (marketplace-service's
 * groq-fallback.service.ts) - either path is a parsing/ranking concern
 * already covered at the unit and API-level test suites. This journey is
 * about navigation and the save/favourite round-trip, which filtered search
 * exercises without depending on parser confidence or an external LLM call.
 *
 * The local catalogue is seeded (database/src/seeds/vehicles.seed.ts, run
 * manually, not CI-enforced) - confirmed non-empty via a direct API probe
 * before writing this. No fixture is created here; the test asserts a
 * result exists rather than assuming a specific listing, so it stays valid
 * however the seed data is regenerated.
 */

async function registerAndLoginBuyer(page: import('@playwright/test').Page) {
  const stamp = Date.now();
  const buyer = {
    name: 'Playwright Search Buyer',
    email: `playwright-search-${stamp}@example.test`,
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

test('buyer can search, open a listing, save it, and find it on their saved page', async ({
  page,
}) => {
  await registerAndLoginBuyer(page);

  const searchPage = new SearchPage(page);
  const detailPage = new VehicleDetailPage(page);
  const savedPage = new SavedPage(page);

  await searchPage.gotoWithFilters({ page: '1', limit: '20' });

  const firstResult = await searchPage.firstResult();
  await expect(firstResult, 'search returned no results - is the local catalogue seeded?').toBeVisible();

  const titleLink = firstResult.locator('.nx-card__title a');
  const title = (await titleLink.textContent())?.trim() ?? '';
  expect(title.length).toBeGreaterThan(0);

  await titleLink.click();
  await expect(page).toHaveURL(/\/vehicles\/[0-9a-f-]+$/);

  await detailPage.expectLoaded();
  const detailTitle = (await detailPage.titleText()).trim();
  expect(detailTitle).toBe(title);

  await detailPage.save();

  await savedPage.goto();
  await savedPage.expectContains(title);
});

test('an unauthenticated visitor is redirected to sign in when trying to save', async ({
  page,
}) => {
  const searchPage = new SearchPage(page);
  const detailPage = new VehicleDetailPage(page);

  await searchPage.gotoWithFilters({ page: '1', limit: '20' });
  const firstResult = await searchPage.firstResult();
  await expect(firstResult).toBeVisible();

  await firstResult.locator('.nx-card__title a').click();
  await detailPage.expectLoaded();

  await detailPage.saveButton().click();
  await expect(page).toHaveURL(/\/login$/);
});
