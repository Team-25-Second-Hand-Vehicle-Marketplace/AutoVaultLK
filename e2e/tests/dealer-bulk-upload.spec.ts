import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { approveDealer } from '../helpers/admin-api';
import { BulkUploadPage } from '../pages/BulkUploadPage';
import { DealerLoginPage } from '../pages/DealerLoginPage';
import { DealerRegisterPage } from '../pages/DealerRegisterPage';
import { UploadStatusPage } from '../pages/UploadStatusPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';

/**
 * Dealer bulk upload -> job-progress observation -> rejections review.
 *
 * Bulk upload is business-dealer-only (RequireDealerType type="business"
 * gates /dealer/upload — see App.tsx), so this registers a BUSINESS dealer
 * (with a real, tiny document upload — auth-user-service's
 * DocumentUploadService validates mimetype/size only, not real image
 * content, so a 68-byte 1x1 PNG fixture is sufficient) rather than reusing
 * the individual-dealer path from dealer-registration.spec.ts.
 *
 * The CSV is generated per run with a UNIQUE registration_number on each
 * row: marketplace.vehicles has a real unique constraint there (upsert
 * idempotency, ADR-002), and a fixed literal collided with a leftover row
 * from an earlier run against this same shared local database, failing the
 * ENTIRE file at the LOAD stage ("registration_number CAB-1234 is already
 * listed") rather than exercising the single-row VALIDATE_ROWS rejection
 * this test is actually about.
 *
 * Row 1 is fully valid; row 2 has price=-100 — a guaranteed VALIDATE_ROWS
 * rejection ("price must be greater than 0, got -100") with a single,
 * unambiguous failure reason, so the terminal status is predictably
 * PARTIAL and the rejections table has exactly one row to assert against.
 * No ZIP is attached: it's optional (ingestion.controller.ts only requires
 * csv), and omitting it keeps the fixture set and the pipeline's
 * image-matching stage out of scope for this journey.
 */

const DOCUMENT_FIXTURE = path.resolve(__dirname, '../fixtures/verification-document.png');

function uniqueDealer() {
  const stamp = Date.now();
  return {
    companyName: `Bulk Upload Motors ${stamp}`,
    businessRegistrationNumber: `PV ${stamp}`,
    businessAddress: '789 Negombo Road',
    city: 'Negombo',
    contactName: 'Bulk Upload Dealer',
    contactNumber: '772345678',
    email: `bulk-upload-dealer-${stamp}@example.test`,
    password: 'Passw0rd!23',
  };
}

test('verified business dealer can bulk upload, watch job progress, and review a rejected row', async ({
  page,
  request,
  baseURL,
}) => {
  const dealer = uniqueDealer();
  const registerPage = new DealerRegisterPage(page);
  const verifyEmailPage = new VerifyEmailPage(page);
  const loginPage = new DealerLoginPage(page);
  const uploadPage = new BulkUploadPage(page);
  const statusPage = new UploadStatusPage(page);

  const regA = `E2E-${randomUUID().slice(0, 8).toUpperCase()}`;
  const regB = `E2E-${randomUUID().slice(0, 8).toUpperCase()}`;
  const csv = [
    'registration_number,make,model,year,price,mileage,fuel_type,transmission,color,engine_capacity_cc,owners_count,location_district',
    `${regA},Toyota,Corolla,2020,5500000,45000,Petrol,Automatic,White,1500,1,Colombo`,
    `${regB},Honda,Civic,2018,-100,30000,Petrol,Manual,Black,1600,2,Gampaha`,
    '',
  ].join('\n');
  const csvDir = path.join(os.tmpdir(), 'autovault-e2e');
  mkdirSync(csvDir, { recursive: true });
  const csvPath = path.join(csvDir, `inventory-${randomUUID()}.csv`);
  writeFileSync(csvPath, csv, 'utf8');

  // --- Register a business dealer and get admin approval ---
  await registerPage.goto();
  await registerPage.fillCompanyInfoBusiness({
    companyName: dealer.companyName,
    businessRegistrationNumber: dealer.businessRegistrationNumber,
    businessAddress: dealer.businessAddress,
    city: dealer.city,
    documentPath: DOCUMENT_FIXTURE,
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
  const { verificationToken, user } = (await registerResponse.json()) as {
    verificationToken?: string;
    user?: { id: string };
  };
  expect(verificationToken).toBeTruthy();

  await verifyEmailPage.gotoWithToken(verificationToken!);
  await verifyEmailPage.expectVerified();

  await approveDealer(request, baseURL!, user!.id);

  // --- Sign in and upload the inventory file ---
  await loginPage.goto();
  await loginPage.login(dealer.email, dealer.password);
  await expect(page).toHaveURL(/\/dealer$/);

  await uploadPage.goto();
  await uploadPage.chooseCsv(csvPath);
  const jobId = await uploadPage.uploadAndWaitForJob();
  expect(jobId).toBeTruthy();

  // --- Observe job progress to a terminal state ---
  const finalStatus = await statusPage.waitForTerminalStatus();
  expect(finalStatus).toContain('Completed with skipped rows');

  await expect(statusPage.tileValue('Rows in file')).toHaveText('2');
  await expect(statusPage.tileValue('Listings created')).toHaveText('1');
  await expect(statusPage.tileValue('Rows skipped')).toHaveText('1');

  // --- Review the rejected row ---
  await expect(statusPage.rejectionsSection()).toBeVisible();
  const row = statusPage.rejectionRow(2); // the file's 2nd data row (regB)
  await expect(row).toBeVisible();
  await expect(row).toContainText('Invalid value');
  await expect(row).toContainText('price must be greater than 0, got -100');
  await expect(row).toContainText(regB);
});
