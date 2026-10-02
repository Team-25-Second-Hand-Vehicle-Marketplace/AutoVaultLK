import http from 'k6/http';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

/**
 * Large ZIP upload stress test - never exercised at any scale close to the
 * real ceiling by any earlier script in this repo. The CSV+ZIP volume test
 * (dealer-ingestion-csv-zip-volume.js) uploads ~22MB; nothing in the repo
 * has come anywhere near ingestion-upload.service.ts's real
 * maxZipSize = 250 * 1024 * 1024 (250MB) hard cap before this.
 *
 * GATEWAY CAP MISMATCH FOUND WHILE BUILDING THIS TEST: api-gateway/local/
 * nginx.conf's `/ingest/` location sets client_max_body_size 25m - far
 * below the service's own 250MB check. A request this size sent THROUGH
 * the gateway (port 8080) would be rejected by nginx with a bare 413 long
 * before ingestion-service's own maxZipSize logic ever runs. This script
 * targets ingestion-service directly on port 3003 (the same convention
 * every other ingestion k6 script in this repo already uses), which is the
 * only path that can actually reach the service-level 250MB check - so it
 * intentionally does NOT exercise the gateway's tighter limit. That
 * mismatch is a real, previously-undocumented finding in its own right: if
 * a 250MB ZIP is genuinely meant to be supported end-to-end (not just
 * service-side), nginx's cap needs raising to match; if 25MB is the real
 * intended ceiling, maxZipSize is effectively dead code for gateway
 * traffic. See 04-load-testing.md's incidents section.
 *
 * Fixtures are synthetic random-byte ZIPs (NOT real/oversized photos like
 * the CSV+ZIP volume test's fixtures), built via
 * ingestion-service/src/tools/vehicle-generator/generate-oversized-zip.ts:
 *
 *   cd ingestion-service
 *   npx tsx src/tools/vehicle-generator/vehicle-generator.ts --count 50 --format csv --mode clean --output test-data/k6-stress2-raw-50.csv
 *   npx tsx src/tools/vehicle-generator/generate-unique-csv.ts --input test-data/k6-stress2-raw-50.csv --output test-data/k6-stress2-50.csv --prefix K6STRESS2
 *   npx tsx src/tools/vehicle-generator/generate-oversized-zip.ts --from-csv test-data/k6-stress2-50.csv --target-mb 245 --output test-data/k6-stress2-245mb.zip
 *   npx tsx src/tools/vehicle-generator/generate-oversized-zip.ts --from-csv test-data/k6-stress2-50.csv --target-mb 260 --output test-data/k6-stress2-260mb-overcap.zip
 *
 * --from-csv (added after the first attempt): the original fixtures named
 * entries STRESS-0001.jpg unconditionally, which never matched the paired
 * CSV's real registration numbers. Every entry was then genuinely
 * "unmatched" in process-job-images.service.ts, each paying the full 30s
 * findVehicleWithRetry budget before ever reaching Sharp - indistinguishable
 * from a true PROCESS_IMAGES hang by symptom alone (both look like
 * "STARTED, no completed_at, no progress" for 5+ minutes). --from-csv makes
 * entries match real rows, so the job actually exercises Sharp instead of
 * stalling in the match-retry loop. See 04-load-testing.md Incident 5.16.
 *
 * Random bytes rather than real images: image-generator.ts's flat-color
 * synthetic photos compress to a few KB regardless of dimensions (confirmed:
 * 3000x2000 -> ~34KB/image), so reaching anywhere near 250MB through that
 * tool would need far more than MAX_ZIP_ENTRIES=2000 entries. This test is
 * about whether upload streaming / multipart parsing / size-limit
 * enforcement survive a ZIP near the real ceiling, not about realistic
 * photo content - incompressible random bytes make --target-mb land
 * accurately (store-mode zlib, see generate-oversized-zip.ts) and are a
 * fair stand-in for "the pipeline must not assume small payloads," which is
 * the actual thing being tested.
 *
 * Two iterations, not a sustained-load shape: this is a single-shot
 * capability/boundary check (does a near-cap upload succeed; does an
 * over-cap upload fail cleanly with 400, not a timeout or a crash), not a
 * concurrency test - sending many 230-260MB uploads at once would mostly
 * measure this machine's disk/network I/O ceiling, a different and less
 * interesting signal than the boundary behavior itself.
 */

const AUTH_BASE_URL = __ENV.AUTH_BASE_URL || 'http://localhost:3001';
const INGESTION_BASE_URL = __ENV.INGESTION_BASE_URL || 'http://localhost:3003';
const ADMIN_BASE_URL = __ENV.ADMIN_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = __ENV.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = __ENV.ADMIN_SEED_PASSWORD;

const CSV_CONTENT = open('../../ingestion-service/test-data/k6-stress2-50.csv');
const ZIP_UNDER_CAP = open('../../ingestion-service/test-data/k6-stress2-245mb.zip', 'b');
const ZIP_OVER_CAP = open('../../ingestion-service/test-data/k6-stress2-260mb-overcap.zip', 'b');

export const options = {
  scenarios: {
    large_zip_stress: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '10m',
    },
  },
  setupTimeout: '2m',
};

const DOCUMENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export function setup() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      'setup: ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD must be set in the environment running this script.',
    );
  }

  const stamp = Date.now();
  const email = `k6-zipstress-dealer-${stamp}@example.test`;
  const password = 'Passw0rd!23';

  const documentBytes = encoding.b64decode(DOCUMENT_PNG_BASE64);
  const uploadDocRes = http.post(`${AUTH_BASE_URL}/documents/verification`, {
    document: http.file(documentBytes, 'verification.png', 'image/png'),
  });
  if (uploadDocRes.status !== 201 && uploadDocRes.status !== 200) {
    throw new Error(`setup: document upload failed (status ${uploadDocRes.status})`);
  }
  const documentKey = JSON.parse(uploadDocRes.body).key;

  const registerRes = http.post(
    `${AUTH_BASE_URL}/auth/register/dealer`,
    JSON.stringify({
      email,
      password,
      name: 'k6 ZIP Stress Dealer',
      dealerType: 'business',
      businessRegistrationNumber: `PV ${stamp}`,
      businessAddress: '1 Test Road',
      city: 'Colombo',
      companyName: `k6 ZIP Stress Motors ${stamp}`,
      contactNumber: '+94771234567',
      verificationDocuments: { businessRegistrationCertificate: documentKey },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (registerRes.status !== 201) {
    throw new Error(`setup: dealer registration failed (status ${registerRes.status}): ${registerRes.body}`);
  }
  const registerBody = JSON.parse(registerRes.body);
  const dealerUserId = registerBody.user.id;

  const verifyRes = http.post(
    `${AUTH_BASE_URL}/auth/email/verify`,
    JSON.stringify({ token: registerBody.verificationToken }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (verifyRes.status !== 200 && verifyRes.status !== 201) {
    throw new Error(`setup: email verification failed (status ${verifyRes.status})`);
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

  const approveRes = http.post(
    `${ADMIN_BASE_URL}/admin/dealers/${dealerUserId}/approve`,
    null,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  if (approveRes.status !== 200 && approveRes.status !== 201) {
    throw new Error(`setup: dealer approval failed (status ${approveRes.status})`);
  }

  const dealerLoginRes = http.post(
    `${AUTH_BASE_URL}/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (dealerLoginRes.status !== 200 && dealerLoginRes.status !== 201) {
    throw new Error(`setup: dealer login failed (status ${dealerLoginRes.status})`);
  }

  return { dealerToken: JSON.parse(dealerLoginRes.body).accessToken };
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.dealerToken}` };

  // 1. Under-cap (230MB of 250MB): expect the upload to be ACCEPTED.
  const underStart = Date.now();
  const underRes = http.post(
    `${INGESTION_BASE_URL}/ingest/upload`,
    {
      format: 'csv',
      file: http.file(CSV_CONTENT, 'inventory.csv', 'text/csv'),
      zip: http.file(ZIP_UNDER_CAP, 'images-245mb.zip', 'application/zip'),
    },
    {
      headers,
      tags: { name: 'ingest_upload_under_cap' },
      timeout: '180s', // a 230MB multipart body needs real time on localhost disk/network
    },
  );
  console.log(
    `large-zip-stress: under-cap (230MB) upload responded ${underRes.status} in ${((Date.now() - underStart) / 1000).toFixed(1)}s`,
  );
  check(underRes, { 'under-cap ZIP accepted (202)': (r) => r.status === 202 });

  // 2. Over-cap (260MB, past the 250MB maxZipSize): expect a clean 4xx
  // rejection, not a timeout, a hang, or a 5xx.
  const overStart = Date.now();
  const overRes = http.post(
    `${INGESTION_BASE_URL}/ingest/upload`,
    {
      format: 'csv',
      file: http.file(CSV_CONTENT, 'inventory.csv', 'text/csv'),
      zip: http.file(ZIP_OVER_CAP, 'images-260mb-overcap.zip', 'application/zip'),
    },
    {
      headers,
      tags: { name: 'ingest_upload_over_cap' },
      timeout: '180s',
    },
  );
  console.log(
    `large-zip-stress: over-cap (260MB) upload responded ${overRes.status} in ${((Date.now() - overStart) / 1000).toFixed(1)}s`,
  );
  check(overRes, {
    'over-cap ZIP cleanly rejected (4xx, not 5xx/timeout)': (r) => r.status >= 400 && r.status < 500,
  });

  // If the under-cap upload was accepted, poll it to a terminal state so the
  // run also confirms the pipeline actually finishes processing a
  // near-cap-sized job, not just that the HTTP layer accepted it.
  if (underRes.status === 202) {
    const jobId = JSON.parse(underRes.body).jobId;
    let status = 'PENDING';
    let pollCount = 0;
    const maxPolls = 150;
    while (!['COMPLETED', 'PARTIAL', 'FAILED'].includes(status) && pollCount < maxPolls) {
      sleep(2);
      const statusRes = http.get(`${INGESTION_BASE_URL}/jobs/${jobId}`, {
        headers,
        tags: { name: 'job_status_poll' },
      });
      if (statusRes.status === 200) status = JSON.parse(statusRes.body).status;
      pollCount += 1;
    }
    console.log(`large-zip-stress: under-cap job ${jobId} reached ${status} after ${pollCount} polls`);
    check(status, {
      'under-cap job reached a terminal state': (s) => s === 'COMPLETED' || s === 'PARTIAL' || s === 'FAILED',
    });
  }
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'large-zip-upload-stress made zero HTTP requests - every step threw before any request fired ' +
        '(check the k6 error log above, setup(), and that the fixture files exist).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
