import { type APIRequestContext } from '@playwright/test';

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
