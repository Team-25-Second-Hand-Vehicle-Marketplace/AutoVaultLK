import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import encoding from 'k6/encoding';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

// isTime=true tells k6 the values passed to .add() are MILLISECONDS, so it
// can auto-format/auto-scale them like its own built-in duration metrics
// (http_req_duration, etc.) - passing seconds directly under that flag is
// what produced a misleadingly tiny "4.2ms" for what was actually a 4.2s
// job (k6 divided the seconds value by 1000 again, on top of the value
// already being in the wrong unit). completionSeconds is computed in
// seconds below for the console.log line's readability; converted to
// milliseconds here so the two stay consistent with what they each claim.
const jobCompletionTrend = new Trend('job_completion_ms', true);

/**
 * Single-user baseline for dealer bulk ingestion - the Test Plan's
 * highest-risk transaction (§3.3.5: "one dealer uploading a large
 * inventory degrades search for every concurrent buyer"). This baseline
 * measures ONE full cycle in isolation, end to end: register a verified
 * business dealer, submit a real CSV upload, and poll job status through
 * to a terminal state - establishing the per-job cost this transaction
 * carries BEFORE any concurrent-load or volume scenario (§3.3.4's stated
 * ordering) makes that cost harder to isolate from contention.
 *
 * Not gated on NFR-09's 500ms bar: this is an async job, not a
 * request/response transaction, and NFR-09 explicitly scopes itself to
 * "CRUD and browse APIs." The metric this script actually reports -
 * job_completion_seconds, a custom Trend - is the number this baseline
 * exists to establish; there is no NFR-derived number to gate it against
 * yet, so this only checks the job reaches a terminal, non-FAILED state.
 *
 * Deliberately NOT a k6 "iteration per VU" shape: registration, approval
 * and upload only need to happen once, so they live in setup() exactly
 * like login-favourites-load.js's account pre-registration - the polling
 * loop that actually measures the job's duration is the only thing that
 * runs as the default function, once.
 */

const AUTH_BASE_URL = __ENV.AUTH_BASE_URL || 'http://localhost:3001';
const INGESTION_BASE_URL = __ENV.INGESTION_BASE_URL || 'http://localhost:3003';
const ADMIN_EMAIL = __ENV.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = __ENV.ADMIN_SEED_PASSWORD;

export const options = {
  scenarios: {
    single_upload: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '3m',
    },
  },
};

const CSV_HEADER =
  'registration_number,make,model,year,price,mileage,fuel_type,transmission,color,engine_capacity_cc,owners_count,location_district,condition,vehicle_type';

function csvRow(reg) {
  return `${reg},Toyota,Corolla,2020,5500000,45000,Petrol,Automatic,White,1500,1,Colombo,Used,Car`;
}

/** A tiny valid 1x1 PNG, base64-decoded - same fixture content as e2e/fixtures/verification-document.png. */
const DOCUMENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export function setup() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      'setup: ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD must be set in the environment running this script.',
    );
  }

  const stamp = Date.now();
  const email = `k6-ingest-dealer-${stamp}@example.test`;
  const password = 'Passw0rd!23';
  const regNumber = `PV ${stamp}`;

  // uploadVerificationDocument first, like DealerRegisterPage.tsx does -
  // registerDealer needs the returned key in verificationDocuments.
  const documentBytes = encoding.b64decode(DOCUMENT_PNG_BASE64);
  const uploadDocRes = http.post(
    `${AUTH_BASE_URL}/documents/verification`,
    { document: http.file(documentBytes, 'verification.png', 'image/png') },
  );
  if (uploadDocRes.status !== 201 && uploadDocRes.status !== 200) {
    throw new Error(
      `setup: document upload failed (status ${uploadDocRes.status}): ${uploadDocRes.body}`,
    );
  }
  const documentKey = JSON.parse(uploadDocRes.body).key;

  const registerRes = http.post(
    `${AUTH_BASE_URL}/auth/register/dealer`,
    JSON.stringify({
      email,
      password,
      name: 'k6 Ingestion Dealer',
      dealerType: 'business',
      businessRegistrationNumber: regNumber,
      businessAddress: '1 Test Road',
      city: 'Colombo',
      companyName: `k6 Ingestion Motors ${stamp}`,
      contactNumber: '+94771234567',
      verificationDocuments: { businessRegistrationCertificate: documentKey },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (registerRes.status !== 201) {
    throw new Error(
      `setup: dealer registration failed (status ${registerRes.status}): ${registerRes.body}`,
    );
  }
  const registerBody = JSON.parse(registerRes.body);
  if (!registerBody.verificationToken) {
    throw new Error(
      'setup: POST /auth/register/dealer did not return verificationToken - ' +
        'is AUTH_RETURN_VERIFICATION_TOKEN=true set on the running auth-user-service?',
    );
  }
  const dealerUserId = registerBody.user.id;

  const verifyRes = http.post(
    `${AUTH_BASE_URL}/auth/email/verify`,
    JSON.stringify({ token: registerBody.verificationToken }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (verifyRes.status !== 200 && verifyRes.status !== 201) {
    throw new Error(`setup: email verification failed (status ${verifyRes.status}): ${verifyRes.body}`);
  }

  // Approve via admin-service's real API, same mechanism as
  // e2e/helpers/admin-api.ts - a direct call, not the admin UI, since this
  // baseline is about the ingestion pipeline, not the admin console.
  const adminLoginRes = http.post(
    `${AUTH_BASE_URL}/auth/login/admin`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (adminLoginRes.status !== 200 && adminLoginRes.status !== 201) {
    throw new Error(`setup: admin login failed (status ${adminLoginRes.status}): ${adminLoginRes.body}`);
  }
  const adminToken = JSON.parse(adminLoginRes.body).accessToken;

  const approveRes = http.post(
    `${AUTH_BASE_URL.replace(':3001', ':3004')}/admin/dealers/${dealerUserId}/approve`,
    null,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  if (approveRes.status !== 200 && approveRes.status !== 201) {
    throw new Error(`setup: dealer approval failed (status ${approveRes.status}): ${approveRes.body}`);
  }

  const dealerLoginRes = http.post(
    `${AUTH_BASE_URL}/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (dealerLoginRes.status !== 200 && dealerLoginRes.status !== 201) {
    throw new Error(`setup: dealer login failed (status ${dealerLoginRes.status}): ${dealerLoginRes.body}`);
  }
  const dealerToken = JSON.parse(dealerLoginRes.body).accessToken;

  return { dealerToken, regNumber: `K6-${stamp}` };
}

export default function (data) {
  const csv = [CSV_HEADER, csvRow(data.regNumber)].join('\n') + '\n';

  const uploadStart = Date.now();
  const uploadRes = http.post(
    `${INGESTION_BASE_URL}/ingest/upload`,
    { format: 'csv', file: http.file(csv, 'inventory.csv', 'text/csv') },
    {
      headers: { Authorization: `Bearer ${data.dealerToken}` },
      tags: { name: 'ingest_upload' },
    },
  );

  check(uploadRes, { 'upload accepted (202)': (r) => r.status === 202 });
  if (uploadRes.status !== 202) {
    throw new Error(`upload failed (status ${uploadRes.status}): ${uploadRes.body}`);
  }
  const jobId = JSON.parse(uploadRes.body).jobId;

  // Poll to a terminal state, same statuses UploadStatusPage.tsx treats as
  // terminal (isTerminal() in ingestion.types.ts): COMPLETED, PARTIAL, FAILED.
  let status = 'PENDING';
  let pollCount = 0;
  const maxPolls = 60; // 60 * 2s = 2 minutes ceiling
  while (!['COMPLETED', 'PARTIAL', 'FAILED'].includes(status) && pollCount < maxPolls) {
    sleep(2);
    const statusRes = http.get(`${INGESTION_BASE_URL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${data.dealerToken}` },
      tags: { name: 'job_status_poll' },
    });
    check(statusRes, { 'job status poll succeeded': (r) => r.status === 200 });
    if (statusRes.status === 200) {
      status = JSON.parse(statusRes.body).status;
    }
    pollCount += 1;
  }

  const completionMs = Date.now() - uploadStart;
  const completionSeconds = completionMs / 1000;
  jobCompletionTrend.add(completionMs);

  check(status, {
    'job reached a terminal, non-FAILED state': (s) => s === 'COMPLETED' || s === 'PARTIAL',
  });

  console.log(
    `Job ${jobId} reached terminal status ${status} in ${completionSeconds.toFixed(1)}s ` +
      `(${pollCount} polls)`,
  );
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'dealer-ingestion-baseline made zero HTTP requests - every step threw before any request ' +
        'fired (check the k6 error log above and setup()).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
