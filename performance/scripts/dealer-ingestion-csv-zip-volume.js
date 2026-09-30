import http from 'k6/http';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

/**
 * CSV + real ZIP/images volume test — the actual dealer bulk-upload
 * experience, not the CSV-only shape dealer-ingestion-volume.js exercises.
 * Nobody uploads a CSV alone in practice if they have photos; the
 * PROCESS_IMAGES stage (registration-number-to-filename matching, Sharp
 * resizing to 1600x1200 main / 400x300 thumbnail per image-processing
 * .stage.ts, S3/local object-store writes) was NEVER exercised by any
 * earlier script in this repo, including the CSV-only volume test — every
 * one of those left the ZIP field empty, since images are optional at the
 * API level.
 *
 * Fixtures are pre-generated (not built inline — k6 has no image-encoding
 * capability, and there is no reason to duplicate the project's own real
 * generator tools), via ingestion-service's own vehicle-generator +
 * generate-unique-csv + image-generator tools:
 *
 *   cd ingestion-service
 *   npx tsx src/tools/vehicle-generator/vehicle-generator.ts --count 600 --format csv --mode clean --output test-data/k6-csvzip-raw-600.csv
 *   npx tsx src/tools/vehicle-generator/generate-unique-csv.ts --input test-data/k6-csvzip-raw-600.csv --output test-data/k6-csvzip-600.csv --prefix K6IMG
 *   npx tsx src/tools/image-generator/image-generator.ts --from-csv test-data/k6-csvzip-600.csv --per-vehicle 3 --width 800 --height 600 --output test-data/k6-csvzip-600-images.zip
 *
 * 600 vehicles x 3 images = 1800 ZIP entries, not the originally-intended
 * 1000/3000: validate-file.stage.ts enforces a real, previously-undocumented
 * MAX_ZIP_ENTRIES = 2000 hard limit — found only by running this test with
 * 3000 entries first and reading the resulting rejection off
 * GET /admin/uploads/:jobId/rejections ("Photo archive has 3000 entries,
 * which exceeds the 2000 limit"), not by reading the source ahead of time.
 * 1800 stays safely under that limit while still exercising real volume.
 *
 * generate-unique-csv.ts exists specifically because vehicle-generator's own
 * WP-0001-style registration numbers are NOT unique across separate
 * generator runs (confirmed by reading its source), and unlike the CSV-only
 * volume test — which can safely rewrite registration_number at UPLOAD time
 * since nothing else depends on the original value — the CSV+ZIP pairing
 * needs the same registration numbers baked into BOTH files at GENERATION
 * time, or the image filenames would no longer match the CSV rows.
 *
 * 800x600 (not the tool's 3000x2000 default): a full-size run at the
 * default dimensions produces a proportionally huge ZIP; this stays well
 * under the backend's 250MB ZIP cap (ingestion-upload.service.ts's
 * maxZipSize) while still exercising the real resize-down path (Sharp
 * shrinks source images, so a real photo above the 1600x1200 target is what
 * PROCESS_IMAGES is built to receive either way).
 */

const AUTH_BASE_URL = __ENV.AUTH_BASE_URL || 'http://localhost:3001';
const INGESTION_BASE_URL = __ENV.INGESTION_BASE_URL || 'http://localhost:3003';
const ADMIN_BASE_URL = __ENV.ADMIN_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = __ENV.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = __ENV.ADMIN_SEED_PASSWORD;

// open()'s binary-file form: reads the file as raw bytes (b (binary) mode),
// not text — required for a ZIP, which is not valid UTF-8. Resolved
// relative to this file's own directory, same as dealer-ingestion-volume.js.
const CSV_CONTENT = open('../../ingestion-service/test-data/k6-csvzip-600.csv');
const ZIP_CONTENT = open('../../ingestion-service/test-data/k6-csvzip-600-images.zip', 'b');

export const options = {
  scenarios: {
    csv_zip_upload: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '10m', // 600 rows + 1800 images to resize/store is real work
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
  const email = `k6-csvzip-dealer-${stamp}@example.test`;
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
      name: 'k6 CSV+ZIP Dealer',
      dealerType: 'business',
      businessRegistrationNumber: `PV ${stamp}`,
      businessAddress: '1 Test Road',
      city: 'Colombo',
      companyName: `k6 CSV+ZIP Motors ${stamp}`,
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
  const uploadStart = Date.now();
  const uploadRes = http.post(
    `${INGESTION_BASE_URL}/ingest/upload`,
    {
      csv: http.file(CSV_CONTENT, 'inventory.csv', 'text/csv'),
      zip: http.file(ZIP_CONTENT, 'images.zip', 'application/zip'),
    },
    {
      headers: { Authorization: `Bearer ${data.dealerToken}` },
      tags: { name: 'ingest_upload_with_images' },
      timeout: '120s', // a ~36MB multipart upload needs more than the default
    },
  );
  check(uploadRes, { 'upload accepted (202)': (r) => r.status === 202 });
  if (uploadRes.status !== 202) {
    throw new Error(`csv+zip volume: upload failed (status ${uploadRes.status}): ${uploadRes.body}`);
  }
  const jobId = JSON.parse(uploadRes.body).jobId;

  let status = 'PENDING';
  let pollCount = 0;
  const maxPolls = 150; // image processing (resize + store x3000) is slower than rows alone
  while (!['COMPLETED', 'PARTIAL', 'FAILED'].includes(status) && pollCount < maxPolls) {
    sleep(2);
    const statusRes = http.get(`${INGESTION_BASE_URL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${data.dealerToken}` },
      tags: { name: 'job_status_poll' },
    });
    if (statusRes.status === 200) status = JSON.parse(statusRes.body).status;
    pollCount += 1;
  }

  const completionMs = Date.now() - uploadStart;

  check(status, {
    'job reached a terminal, non-FAILED state': (s) => s === 'COMPLETED' || s === 'PARTIAL',
  });

  console.log(
    `csv+zip volume: job ${jobId} reached ${status} in ${(completionMs / 1000).toFixed(1)}s ` +
      `(${pollCount} polls) — 600 rows, 1800 images`,
  );
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'dealer-ingestion-csv-zip-volume made zero HTTP requests — every step threw before any ' +
        'request fired (check the k6 error log above, setup(), and that the fixture files exist).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
