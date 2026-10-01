import { expect, test } from '@playwright/test';
import { AdminAuditLogsPage } from '../pages/AdminAuditLogsPage';
import { AdminDashboardPage } from '../pages/AdminDashboardPage';
import { AdminLoginPage } from '../pages/AdminLoginPage';
import { AdminUsersPage } from '../pages/AdminUsersPage';
import { DealerRegisterPage } from '../pages/DealerRegisterPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';

/**
 * Admin login -> dashboard -> user management -> approve a pending dealer
 * through the real admin UI (not the direct API helper
 * dealer-registration.spec.ts uses) -> audit log review confirming the
 * approval was recorded.
 *
 * Registers a fresh dealer via the UI first, so there is a genuinely
 * PENDING row to find and act on - a dashboard/users/audit-log journey
 * against an empty or already-settled dataset would not exercise the
 * approve action or the resulting audit entry at all.
 */

function uniqueDealer() {
  const stamp = Date.now();
  return {
    companyName: `Admin Journey Motors ${stamp}`,
    businessAddress: '456 Kandy Road',
    city: 'Kandy',
    nicNumber: '199912345678',
    contactName: 'Admin Journey Dealer',
    contactNumber: '719876543',
    email: `admin-journey-dealer-${stamp}@example.test`,
    password: 'Passw0rd!23',
  };
}

test('admin can review the dashboard, approve a pending dealer, and find it in the audit log', async ({
  page,
}) => {
  const dealer = uniqueDealer();
  const dealerRegisterPage = new DealerRegisterPage(page);
  const verifyEmailPage = new VerifyEmailPage(page);
  const adminLoginPage = new AdminLoginPage(page);
  const dashboardPage = new AdminDashboardPage(page);
  const usersPage = new AdminUsersPage(page);
  const auditLogsPage = new AdminAuditLogsPage(page);

  // --- Create a real PENDING dealer to act on ---
  await dealerRegisterPage.goto();
  await dealerRegisterPage.fillCompanyInfoIndividual({
    companyName: dealer.companyName,
    businessAddress: dealer.businessAddress,
    city: dealer.city,
    nicNumber: dealer.nicNumber,
  });
  await dealerRegisterPage.continueStep('Contact Details');
  await dealerRegisterPage.fillContactDetails({
    name: dealer.contactName,
    contactNumber: dealer.contactNumber,
  });
  await dealerRegisterPage.continueStep('Account Setup');
  await dealerRegisterPage.fillAccountSetup({ email: dealer.email, password: dealer.password });

  await dealerRegisterPage.continueStep('Review');

  const registerResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/auth/register/dealer') &&
      response.request().method() === 'POST',
  );
  await dealerRegisterPage.submit();
  const registerResponse = await registerResponsePromise;
  const { verificationToken, user } = (await registerResponse.json()) as {
    verificationToken?: string;
    user?: { id: string };
  };
  expect(verificationToken).toBeTruthy();
  const dealerUserId = user!.id;

  await verifyEmailPage.gotoWithToken(verificationToken!);
  await verifyEmailPage.expectVerified();

  // --- Baseline: read the dashboard's pending-approvals count before acting ---
  await adminLoginPage.goto();
  await adminLoginPage.login(
    process.env.ADMIN_SEED_EMAIL!,
    process.env.ADMIN_SEED_PASSWORD!,
  );
  await expect(page).toHaveURL(/\/admin$/);
  await dashboardPage.expectLoaded();

  const pendingBefore = Number(
    (await dashboardPage.kpiValue('Pending approvals').textContent())?.replace(/,/g, ''),
  );

  // --- Approve the dealer through the real admin UI ---
  await dashboardPage.goToUsers();
  await expect(page).toHaveURL(/\/admin\/users$/);

  await usersPage.gotoPendingTab();
  await expect(usersPage.rowFor(dealer.email)).toBeVisible();
  await usersPage.approve(dealer.email);
  await usersPage.expectRowGone(dealer.email);

  // --- Dashboard reflects the approval ---
  await dashboardPage.goto();
  const pendingAfter = Number(
    (await dashboardPage.kpiValue('Pending approvals').textContent())?.replace(/,/g, ''),
  );
  expect(pendingAfter).toBe(pendingBefore - 1);

  // --- Audit log records the action ---
  await dashboardPage.goToAuditLogs();
  await expect(page).toHaveURL(/\/admin\/audit-logs$/);
  await auditLogsPage.searchByAction('dealer.approved');
  await auditLogsPage.expectRowForEntity(dealerUserId);
});
