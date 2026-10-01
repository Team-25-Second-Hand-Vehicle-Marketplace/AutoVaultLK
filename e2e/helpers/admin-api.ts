import { type APIRequestContext } from '@playwright/test';

/**
 * Approves a dealer directly via admin-service's real API, bypassing the
 * admin UI. This journey's point is proving a dealer can register, verify,
 * sign in pre-approval, and use their profile once verified - not proving
 * the admin console's own click-through, which is a separate journey. A
 * direct API call keeps this test from depending on a second UI surface
 * that isn't the one under test here.
 *
 * Requires ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD to match a real seeded
 * admin (database/src/seeds/admin-user.seed.ts) - no default exists, since
 * the seed script itself refuses to run without an explicit password.
 */
export async function approveDealer(
  request: APIRequestContext,
  baseURL: string,
  dealerUserId: string,
): Promise<void> {
  const adminEmail = process.env.ADMIN_SEED_EMAIL;
  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error(
      'ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD are not set in the environment running this test - ' +
        'set them to the same values used to seed the local admin user.',
    );
  }

  const loginResponse = await request.post(`${baseURL}/auth/login/admin`, {
    data: { email: adminEmail, password: adminPassword },
  });
  if (!loginResponse.ok()) {
    throw new Error(
      `Admin login failed (${loginResponse.status()}) - is the seeded admin user present in the local database?`,
    );
  }
  const { accessToken } = (await loginResponse.json()) as { accessToken: string };

  const approveResponse = await request.post(
    `${baseURL}/admin/dealers/${dealerUserId}/approve`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!approveResponse.ok()) {
    throw new Error(`Dealer approval failed (${approveResponse.status()})`);
  }
}
