import http from 'k6/http';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

/**
 * DB connection-pool exhaustion test - every earlier ingestion script in
 * this repo ran ONE upload at a time (dealer-ingestion-volume.js is
 * explicitly sequential by design; the CSV+ZIP volume test is a single
 * iteration). Nothing has driven MULTIPLE CONCURRENT uploads against
 * ingestion-service, so nothing has exercised its Postgres pool under real
 * contention.
 *
 * The real, previously-undocumented condition this test targets: every
 * service's database.config.ts sets `extra: { max: 5 }` - a 5-connection
 * pg pool, confirmed identical across auth-user-service, ingestion-service,
 * admin-service, notification-service, and marketplace-service (grepped
 * directly, not assumed). ingestion-service's own INGESTION_MAX_CONCURRENCY
 * (.env, default 10) already describes MORE concurrent chunk-processing
 * slots than the pool has connections to serve - meaning pool contention is
 * a latent condition in the pipeline's OWN designed concurrency, not
 * something this test artificially invents. NUM_CONCURRENT_UPLOADS defaults
 * to 8: comfortably past the 5-connection ceiling, without being so far past
 * it that the result is just "everything times out" rather than a readable
 * degradation curve.
 *
 * Each VU registers and gets its own dealer (setup()) and uploads a small,
 * distinctly-prefixed CSV (k6-volume-100.csv, 100 rows, rewritten
 * per-VU the same way dealer-ingestion-volume.js does) at the same moment,
 * via a single rendezvous-style scenario (all VUs start together, one
 * iteration each) - the goal is genuine simultaneous pool pressure, not a
 * ramped approach to it.
 *
 * What "pass" means here is NOT "every upload completes fast" - a pool of 5
 * genuinely CANNOT serve 8 concurrent LOAD-stage writers without some
 * queuing. What this checks is that the service degrades by QUEUING
 * (requests wait longer, then complete) rather than by failing outright
 * (connection errors, 500s, or the job-status GET endpoint itself becoming
 * unreachable while uploads are in flight) - that's the actual
 * correctness bar for pool contention, not a latency target.
 */

const AUTH_BASE_URL = __ENV.AUTH_BASE_URL || 'http://localhost:3001';
const INGESTION_BASE_URL = __ENV.INGESTION_BASE_URL || 'http://localhost:3003';
const ADMIN_BASE_URL = __ENV.ADMIN_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = __ENV.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = __ENV.ADMIN_SEED_PASSWORD;

const NUM_CONCURRENT_UPLOADS = Number(__ENV.NUM_CONCURRENT_UPLOADS || 8);

// Read once at init time, same as every other ingestion k6 script - k6
// resolves open() relative to this file's own directory, not the CWD.
const CSV_TEMPLATE = open('../../ingestion-service/test-data/k6-volume-100.csv');

export const options = {
  scenarios: {
    pool_exhaustion: {
      executor: 'shared-iterations',
      vus: NUM_CONCURRENT_UPLOADS,
      iterations: NUM_CONCURRENT_UPLOADS,
      maxDuration: '5m',
    },
  },
  thresholds: {
    // Not a latency bar (see header) - the only hard requirement is that
    // uploads don't outright fail, and that job-status reads (a cheap,
    // separate query) stay responsive even while the pool is under pressure
    // from concurrent LOAD-stage writers.
    'http_req_failed{name:ingest_upload}': ['rate<0.05'],
    'http_req_failed{name:job_status_poll}': ['rate<0.05'],
  },
  setupTimeout: '3m',
};

const DOCUMENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** Same rewrite approach as dealer-ingestion-volume.js, keyed per-VU so concurrent uploads never collide. */
function makeRegistrationNumbersUnique(csvContent, uniquePrefix) {
  const lines = csvContent.trim().split('\n');
  const header = lines[0];
  const regColumnIndex = header.split(',').indexOf('registration_number');

  const rewritten = lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(',');
    cells[regColumnIndex] = `${uniquePrefix}-${rowIndex}`;
    return cells.join(',');
  });

  return [header, ...rewritten].join('\n') + '\n';
}

function registerAndApproveDealer(vuIndex) {
  const stamp = `${Date.now()}-${vuIndex}`;
  const email = `k6-poolstress-dealer-${stamp}@example.test`;
  const password = 'Passw0rd!23';

  const documentBytes = encoding.b64decode(DOCUMENT_PNG_BASE64);
  const uploadDocRes = http.post(`${AUTH_BASE_URL}/documents/verification`, {
    document: http.file(documentBytes, 'verification.png', 'image/png'),
  });
  if (uploadDocRes.status !== 201 && uploadDocRes.status !== 200) {
    throw new Error(`setup: VU ${vuIndex} document upload failed (status ${uploadDocRes.status})`);
  }
  const documentKey = JSON.parse(uploadDocRes.body).key;

  const registerRes = http.post(
    `${AUTH_BASE_URL}/auth/register/dealer`,
    JSON.stringify({
      email,
      password,
      name: `k6 Pool Stress Dealer ${vuIndex}`,
      dealerType: 'business',
      businessRegistrationNumber: `PV ${stamp}`,
      businessAddress: '1 Test Road',
      city: 'Colombo',
      companyName: `k6 Pool Stress Motors ${stamp}`,
      contactNumber: '+94771234567',
      verificationDocuments: { businessRegistrationCertificate: documentKey },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (registerRes.status !== 201) {
    throw new Error(`setup: VU ${vuIndex} dealer registration failed (status ${registerRes.status}): ${registerRes.body}`);
  }
  const registerBody = JSON.parse(registerRes.body);
  const dealerUserId = registerBody.user.id;

  const verifyRes = http.post(
    `${AUTH_BASE_URL}/auth/email/verify`,
    JSON.stringify({ token: registerBody.verificationToken }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (verifyRes.status !== 200 && verifyRes.status !== 201) {
    throw new Error(`setup: VU ${vuIndex} email verification failed (status ${verifyRes.status})`);
  }

  return { dealerUserId, email, password, stamp };
}

export function setup() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      'setup: ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD must be set in the environment running this script.',
    );
  }

  const adminLoginRes = http.post(
    `${AUTH_BASE_URL}/auth/login/admin`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (adminLoginRes.status !== 200 && adminLoginRes.status !== 201) {
    throw new Error(`setup: admin login failed (status ${adminLoginRes.status})`);
  }
  const adminToken = JSON.parse(adminLoginRes.body).accessToken;

  const dealers = [];
  for (let i = 0; i < NUM_CONCURRENT_UPLOADS; i++) {
    const { dealerUserId, email, password, stamp } = registerAndApproveDealer(i);

    const approveRes = http.post(
      `${ADMIN_BASE_URL}/admin/dealers/${dealerUserId}/approve`,
      null,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    if (approveRes.status !== 200 && approveRes.status !== 201) {
      throw new Error(`setup: VU ${i} dealer approval failed (status ${approveRes.status})`);
    }

    const dealerLoginRes = http.post(
      `${AUTH_BASE_URL}/auth/login`,
      JSON.stringify({ email, password }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (dealerLoginRes.status !== 200 && dealerLoginRes.status !== 201) {
      throw new Error(`setup: VU ${i} dealer login failed (status ${dealerLoginRes.status})`);
    }

    dealers.push({ dealerToken: JSON.parse(dealerLoginRes.body).accessToken, stamp });
  }

  return { dealers };
}

export default function (data) {
  const vuIndex = __VU - 1;
  const { dealerToken, stamp } = data.dealers[vuIndex];
  const uniqueCsv = makeRegistrationNumbersUnique(CSV_TEMPLATE, `K6POOL-${stamp}`);

  const uploadStart = Date.now();
  const uploadRes = http.post(
    `${INGESTION_BASE_URL}/ingest/upload`,
    { csv: http.file(uniqueCsv, 'inventory.csv', 'text/csv') },
    {
      headers: { Authorization: `Bearer ${dealerToken}` },
      tags: { name: 'ingest_upload' },
      timeout: '60s',
    },
  );
  check(uploadRes, { 'upload accepted (202)': (r) => r.status === 202 });
  if (uploadRes.status !== 202) {
    console.error(`db-pool-exhaustion VU ${__VU}: upload failed (status ${uploadRes.status}): ${uploadRes.body}`);
    return;
  }
  const jobId = JSON.parse(uploadRes.body).jobId;

  let status = 'PENDING';
  let pollCount = 0;
  const maxPolls = 60;
  while (!['COMPLETED', 'PARTIAL', 'FAILED'].includes(status) && pollCount < maxPolls) {
    sleep(1);
    const statusRes = http.get(`${INGESTION_BASE_URL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${dealerToken}` },
      tags: { name: 'job_status_poll' },
    });
    check(statusRes, { 'status poll succeeded': (r) => r.status === 200 });
    if (statusRes.status === 200) status = JSON.parse(statusRes.body).status;
    pollCount += 1;
  }

  const completionMs = Date.now() - uploadStart;
  console.log(
    `db-pool-exhaustion: VU ${__VU} job ${jobId} reached ${status} in ${(completionMs / 1000).toFixed(1)}s (${pollCount} polls)`,
  );
  check(status, {
    'job reached a terminal, non-FAILED state': (s) => s === 'COMPLETED' || s === 'PARTIAL',
  });
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'db-pool-exhaustion made zero HTTP requests - every iteration threw before any request fired ' +
        '(check the k6 error log above and setup()).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
