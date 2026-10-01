import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import encoding from 'k6/encoding';
import exec from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

/**
 * End-to-end concurrent load: the realistic mixed-traffic scenario -
 * multiple buyers searching/browsing/favouriting (via both filtered AND
 * natural-language search) AND multiple dealers each bulk-uploading
 * inventory, all running in the SAME k6 process at the SAME time, against
 * the SAME database. This is the specific risk the Test Plan names as the
 * reason Load Testing exists as its own technique (§3.3.5): "The risk is
 * therefore not that either fails alone, but that one dealer uploading a
 * large inventory degrades search for every concurrent buyer" - extended
 * here to several dealers uploading at once, not just one, since that is
 * the more realistic "everything happening together" shape of production
 * traffic, not a single isolated actor.
 *
 * Two independent k6 scenarios, run concurrently by k6's own scheduler:
 *   - buyer_traffic: NUM_BUYERS concurrent buyers, each looping through
 *     filtered search -> vehicle detail -> favourite. A small fraction
 *     (NL_SEARCH_BUYER_FRACTION) also issue a natural-language search each
 *     iteration - capped deliberately: NL search hits a REAL external Groq
 *     API call with no client-side rate limiting (confirmed by inspection
 *     of groq-fallback.service.ts), and every one of NUM_BUYERS VUs firing
 *     NL search concurrently risks tripping Groq's own account rate limit,
 *     which would produce a false failure signal about Groq, not about
 *     AutoVaultLK. Only some buyers using NL search is also the more
 *     realistic mix - most real searches are filtered, not natural-language.
 *   - dealer_ingestion: NUM_DEALERS dealers, each uploading their own file
 *     concurrently, staggered slightly so they don't all submit in the
 *     same tick - the risk under test is "N dealers uploading around the
 *     same time", not "N dealers submitting the exact same millisecond".
 *
 * Thresholds are scoped PER SCENARIO via tag filters: buyer-facing calls
 * are gated on NFR-09 (p95<500ms) even while multiple dealers ingest
 * concurrently - that is the actual pass/fail question this script
 * answers. Ingestion jobs' own completion times have no NFR to gate on
 * (same reasoning as dealer-ingestion-baseline.js) and are reported only.
 *
 * Run size is set by LEVEL (0-4, see LEVELS below). Level 0 is the smoke
 * level; each level up adds buyers, dealers, CSV rows and images.
 *
 * Points at local services by default; override AUTH_BASE_URL /
 * MARKETPLACE_BASE_URL / INGESTION_BASE_URL / ADMIN_BASE_URL to run the
 * exact same script against a deployed environment - no separate
 * staging copy of this file is needed.
 */

const AUTH_BASE_URL = __ENV.AUTH_BASE_URL || 'http://localhost:3001';
const MARKETPLACE_BASE_URL = __ENV.MARKETPLACE_BASE_URL || 'http://localhost:3002';
const INGESTION_BASE_URL = __ENV.INGESTION_BASE_URL || 'http://localhost:3003';
const ADMIN_BASE_URL = __ENV.ADMIN_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = __ENV.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = __ENV.ADMIN_SEED_PASSWORD;

/**
 * LEVEL presets (select with -e LEVEL=0..4; NUM_BUYERS / NUM_DEALERS may
 * still override a preset's counts). Levels 2-4 use 4 images per vehicle row;
 * level 0 is exactly 2 rows / 3 images.
 *
 *   level  buyers  dealers  csv rows  images/dealer  buyer hold  dealer ceiling
 *     0       1       1         2          3             30s         3m
 *     1      50       3        15          0             2m          3m
 *     2      50       3        15         60             3m          6m
 *     3     200      10        50        200            4m          10m
 *     4     400      20       150        600            8m          20m
 *
 * Levels 2-4 upload a pre-generated CSV+ZIP pair per dealer. The pairs must be
 * generated immediately before each run (registration_number is globally
 * unique, so a pair can only be ingested once per database):
 *
 *   bash performance/tools/generate-e2e-fixtures.sh <level>
 *
 * NL_SEARCH_BUYER_FRACTION drops at higher levels: every NL search is a real
 * Groq API call, and 400 buyers x 20% would mean ~80 concurrent callers for
 * the whole hold window, tripping Groq's account limit rather than testing
 * AutoVaultLK.
 */
const LEVELS = {
  0: { buyers: 1, dealers: 1, rows: 2, images: 3, hold: '30s', dealerMaxSec: 180, nlFraction: 0.2 },
  1: { buyers: 50, dealers: 3, rows: 15, images: 0, hold: '2m', dealerMaxSec: 180, nlFraction: 0.2 },
  2: { buyers: 50, dealers: 3, rows: 15, images: 60, hold: '3m', dealerMaxSec: 360, nlFraction: 0.2 },
  3: { buyers: 200, dealers: 10, rows: 50, images: 200, hold: '4m', dealerMaxSec: 600, nlFraction: 0.1 },
  4: { buyers: 400, dealers: 20, rows: 150, images: 600, hold: '8m', dealerMaxSec: 1200, nlFraction: 0.05 },
};
// Buyers' tokens are minted in setup() and last 15m, so keep ramp + hold under that.
const LEVEL = Number(__ENV.LEVEL || 0);
const PRESET = LEVELS[LEVEL];
if (!PRESET) {
  throw new Error(`LEVEL must be one of ${Object.keys(LEVELS).join(', ')} (got "${__ENV.LEVEL}")`);
}

const NUM_BUYERS = Number(__ENV.NUM_BUYERS || PRESET.buyers);
const NUM_DEALERS = Number(__ENV.NUM_DEALERS || PRESET.dealers);
// __VU is numbered across ALL scenarios, so buyer VUs can carry any id in
// 1..(NUM_BUYERS + NUM_DEALERS). One account per possible id keeps each buyer VU
// on its own account; fewer accounts would map two VUs onto one buyer.
const NUM_BUYER_ACCOUNTS = NUM_BUYERS + NUM_DEALERS;
const NL_SEARCH_BUYER_FRACTION = Number(__ENV.NL_SEARCH_BUYER_FRACTION || PRESET.nlFraction);
const DEALER_UPLOAD_ROWS = PRESET.rows;
const DEALER_UPLOAD_IMAGES = PRESET.images;
const FIXTURE_DIR = '../../ingestion-service/test-data/e2e-load';

// open() is init-context only, and every VU shares one copy of each file.
// Only the files this level actually needs are loaded.
const DEALER_FIXTURES = [];
if (DEALER_UPLOAD_IMAGES > 0) {
  for (let i = 0; i < NUM_DEALERS; i++) {
    DEALER_FIXTURES.push({
      csv: open(`${FIXTURE_DIR}/dealer-${i}.csv`),
      zip: open(`${FIXTURE_DIR}/dealer-${i}.zip`, 'b'),
    });
  }
}

export const options = {
  scenarios: {
    buyer_traffic: {
      executor: 'ramping-vus',
      exec: 'buyerTraffic',
      startVUs: 0,
      stages: [
        { duration: '20s', target: NUM_BUYERS },
        { duration: __ENV.HOLD || PRESET.hold, target: NUM_BUYERS },
        { duration: '20s', target: 0 },
      ],
    },
    dealer_ingestion: {
      // shared-iterations with iterations == vus: each dealer VU runs exactly one
      // iteration, and exec.scenario.iterationInTest gives each a unique 0..N-1
      // index. __VU cannot be used for that: it is numbered across ALL scenarios,
      // so dealer VUs come after (or among) the buyer VUs.
      executor: 'shared-iterations',
      exec: 'dealerIngestion',
      vus: NUM_DEALERS,
      iterations: NUM_DEALERS,
      // Starts 30s in, so uploads overlap buyer_traffic's hold stage
      // rather than racing its own ramp-up.
      startTime: '30s',
      maxDuration: `${PRESET.dealerMaxSec}s`,
    },
  },
  thresholds: {
    'http_req_duration{name:search_filters}': ['p(95)<500'],
    'http_req_duration{name:vehicle_detail}': ['p(95)<500'],
    'http_req_duration{name:get_favourites}': ['p(95)<500'],
    'http_req_duration{name:save_favourite}': ['p(95)<500'],
    // NL search is gated on the SRS's own 2s warm-start figure (NFR-09),
    // not the 500ms CRUD/browse bar - same reasoning as nl-search-baseline.js.
    'http_req_duration{name:nl_search}': ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
  // Account registration is batched (see setup()), but bcrypt hashing of up to
  // 420 accounts still takes real time at higher levels.
  setupTimeout: LEVEL >= 3 ? '10m' : '4m',
};

const DOCUMENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const CSV_HEADER =
  'registration_number,make,model,year,price,mileage,fuel_type,transmission,color,engine_capacity_cc,owners_count,location_district,condition,vehicle_type';

// Only make/model combinations already known to pass validation.
const MAKES = [
  ['Toyota', 'Corolla', 'Petrol', 'Automatic', 1500],
  ['Honda', 'Civic', 'Petrol', 'Manual', 1600],
];
const DISTRICTS = ['Colombo', 'Kandy'];

/** Level 1 only (CSV, no images): rows built inline, no fixture files needed. */
function buildInlineCsv(regPrefix, rows) {
  const lines = [CSV_HEADER];
  for (let n = 1; n <= rows; n++) {
    const [make, model, fuel, trans, cc] = MAKES[n % MAKES.length];
    lines.push(
      [`${regPrefix}-${n}`, make, model, 2012 + (n % 12), 3000000 + n * 50000, 20000 + n * 1500,
        fuel, trans, 'White', cc, 1 + (n % 3), DISTRICTS[n % DISTRICTS.length], 'Used', 'Car'].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * Every simulated user gets its own client IP via X-Forwarded-For (auth reads
 * the first entry). Real buyers/dealers come from different addresses; sending
 * all 420 registrations from one IP would trip auth's per-IP registration cap
 * (max 100 per window, validated in auth-user-service app.module.ts) and test
 * the rate limiter instead of the system. i is a stable per-user index.
 */
function jsonHeadersFor(kind, i) {
  const base = kind === 'buyer' ? 10 : 11;
  return {
    'Content-Type': 'application/json',
    'X-Forwarded-For': `${base}.${(i >> 8) & 255}.${i & 255}.${1 + ((i * 7) % 250)}`,
  };
}

const jobCompletionTrend = new Trend('ingestion_job_completion_ms', true);

const NL_QUERIES = [
  'red Toyota Aqua under 6 million',
  'cheap manual petrol car in Colombo',
  'Honda Civic 2018 or newer',
];

/**
 * Registers the buyer accounts and NUM_DEALERS verified business dealer
 * accounts before either scenario starts, so all registration/
 * verification/approval cost stays out of the measured windows.
 *
 * Uses http.batch() for the registration calls themselves (the genuinely
 * expensive, independent part - each does a real bcrypt.hash + DB write
 * server-side) rather than a sequential for-loop: the earlier version of
 * this script sent registrations one at a time and setup() would not
 * reliably finish inside even a 3-minute timeout once account counts grew.
 * Verification and dealer approval remain sequential per-account (each
 * depends on that account's own registration response), but batching the
 * registrations themselves is what actually removes the bottleneck.
 */
export function setup() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      'setup: ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD must be set in the environment running this script.',
    );
  }

  const stamp = Date.now();

  // --- Batch-register all buyers concurrently ---
  const buyerRegisterRequests = [];
  for (let i = 0; i < NUM_BUYER_ACCOUNTS; i++) {
    buyerRegisterRequests.push([
      'POST',
      `${AUTH_BASE_URL}/auth/register/buyer`,
      JSON.stringify({
        name: `k6 E2E Buyer ${i}`,
        email: `k6-e2e-buyer-${stamp}-${i}@example.test`,
        password: 'Passw0rd!23',
      }),
      { headers: jsonHeadersFor('buyer', i) },
    ]);
  }
  const buyerRegisterResponses = http.batch(buyerRegisterRequests);

  const buyers = [];
  buyerRegisterResponses.forEach((res, i) => {
    if (res.status !== 201) {
      throw new Error(`setup: registration failed for buyer ${i} (status ${res.status}): ${res.body}`);
    }
    const body = JSON.parse(res.body);
    if (!body.verificationToken) {
      throw new Error(
        'setup: POST /auth/register/buyer did not return verificationToken - ' +
          'is AUTH_RETURN_VERIFICATION_TOKEN=true set?',
      );
    }
    buyers.push({
      email: `k6-e2e-buyer-${stamp}-${i}@example.test`,
      password: 'Passw0rd!23',
      verificationToken: body.verificationToken,
    });
  });

  // --- Batch-verify all buyers concurrently ---
  const buyerVerifyRequests = buyers.map((b, i) => [
    'POST',
    `${AUTH_BASE_URL}/auth/email/verify`,
    JSON.stringify({ token: b.verificationToken }),
    { headers: jsonHeadersFor('buyer', i) },
  ]);
  const buyerVerifyResponses = http.batch(buyerVerifyRequests);
  buyerVerifyResponses.forEach((res, i) => {
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`setup: verification failed for buyer ${i} (status ${res.status})`);
    }
  });

  // Log every buyer in here, not inside the VUs. auth-user-service hashes with
  // bcryptjs (pure JS, on the event loop), so one process manages only ~2-3
  // logins/s; 200-400 buyers logging in during the ramp-up queue past k6's 60s
  // request timeout and most never start. The measured window is meant to be
  // browse/search/favourite traffic, so login throughput is kept out of it.
  // Tokens last 15m (JWT_ACCESS_EXPIRES_IN), which covers every level's run.
  const buyerLoginRequests = buyers.map((b, i) => [
    'POST',
    `${AUTH_BASE_URL}/auth/login`,
    JSON.stringify({ email: b.email, password: b.password }),
    { headers: jsonHeadersFor('buyer', i), timeout: '300s' },
  ]);
  http.batch(buyerLoginRequests).forEach((res, i) => {
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`setup: login failed for buyer ${i} (status ${res.status})`);
    }
    buyers[i].accessToken = JSON.parse(res.body).accessToken;
  });

  const searchRes = http.get(`${MARKETPLACE_BASE_URL}/search/filters?limit=1`);
  if (searchRes.status !== 200) {
    throw new Error(`setup: could not fetch a vehicle id (status ${searchRes.status})`);
  }
  const items = JSON.parse(searchRes.body).items;
  if (!items || items.length === 0) {
    throw new Error('setup: local catalogue is empty - is it seeded (database/ seed:vehicles)?');
  }

  // --- Set up NUM_DEALERS verified business dealers ---
  // Document upload + registration are batched across dealers; verification
  // and admin approval remain sequential per-dealer (small N, and approval
  // needs one admin login shared across all of them).
  const documentBytes = encoding.b64decode(DOCUMENT_PNG_BASE64);
  const dealerDocRequests = [];
  for (let i = 0; i < NUM_DEALERS; i++) {
    dealerDocRequests.push([
      'POST',
      `${AUTH_BASE_URL}/documents/verification`,
      { document: http.file(documentBytes, `verification-${i}.png`, 'image/png') },
    ]);
  }
  const dealerDocResponses = http.batch(dealerDocRequests);
  const documentKeys = dealerDocResponses.map((res, i) => {
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`setup: dealer ${i} document upload failed (status ${res.status})`);
    }
    return JSON.parse(res.body).key;
  });

  const dealerRegisterRequests = [];
  for (let i = 0; i < NUM_DEALERS; i++) {
    dealerRegisterRequests.push([
      'POST',
      `${AUTH_BASE_URL}/auth/register/dealer`,
      JSON.stringify({
        email: `k6-e2e-dealer-${stamp}-${i}@example.test`,
        password: 'Passw0rd!23',
        name: `k6 E2E Dealer ${i}`,
        dealerType: 'business',
        businessRegistrationNumber: `PV ${stamp}-${i}`,
        businessAddress: '1 Test Road',
        city: 'Colombo',
        companyName: `k6 E2E Motors ${stamp}-${i}`,
        contactNumber: '+94771234567',
        verificationDocuments: { businessRegistrationCertificate: documentKeys[i] },
      }),
      { headers: jsonHeadersFor('dealer', i) },
    ]);
  }
  const dealerRegisterResponses = http.batch(dealerRegisterRequests);

  const dealers = dealerRegisterResponses.map((res, i) => {
    if (res.status !== 201) {
      throw new Error(`setup: dealer ${i} registration failed (status ${res.status}): ${res.body}`);
    }
    const body = JSON.parse(res.body);
    return {
      email: `k6-e2e-dealer-${stamp}-${i}@example.test`,
      password: 'Passw0rd!23',
      userId: body.user.id,
      verificationToken: body.verificationToken,
      regPrefix: `E2E-${stamp}-${i}`,
    };
  });

  const dealerVerifyRequests = dealers.map((d, i) => [
    'POST',
    `${AUTH_BASE_URL}/auth/email/verify`,
    JSON.stringify({ token: d.verificationToken }),
    { headers: jsonHeadersFor('dealer', i) },
  ]);
  const dealerVerifyResponses = http.batch(dealerVerifyRequests);
  dealerVerifyResponses.forEach((res, i) => {
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`setup: dealer ${i} verification failed (status ${res.status})`);
    }
  });

  const adminLoginRes = http.post(
    `${AUTH_BASE_URL}/auth/login/admin`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (adminLoginRes.status !== 200 && adminLoginRes.status !== 201) {
    throw new Error(`setup: admin login failed (status ${adminLoginRes.status})`);
  }
  const adminToken = JSON.parse(adminLoginRes.body).accessToken;

  const approveRequests = dealers.map((d) => [
    'POST',
    `${ADMIN_BASE_URL}/admin/dealers/${d.userId}/approve`,
    null,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  ]);
  const approveResponses = http.batch(approveRequests);
  approveResponses.forEach((res, i) => {
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`setup: dealer ${i} approval failed (status ${res.status})`);
    }
  });

  const dealerLoginRequests = dealers.map((d, i) => [
    'POST',
    `${AUTH_BASE_URL}/auth/login`,
    JSON.stringify({ email: d.email, password: d.password }),
    { headers: jsonHeadersFor('dealer', i) },
  ]);
  const dealerLoginResponses = http.batch(dealerLoginRequests);
  dealerLoginResponses.forEach((res, i) => {
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`setup: dealer ${i} login failed (status ${res.status})`);
    }
    dealers[i].token = JSON.parse(res.body).accessToken;
  });

  return { buyers, vehicleId: items[0].id, dealers };
}

/**
 * buyer_traffic scenario: filtered search -> detail -> favourite; a
 * fraction also issue NL search. Buyers arrive already logged in (see setup()).
 * Every iteration ends in sleep(1) so a VU behaves like a paced session.
 */
export function buyerTraffic(data) {
  const buyer = data.buyers[(__VU - 1) % data.buyers.length];

  const authHeaders = {
    headers: { Authorization: `Bearer ${buyer.accessToken}`, 'Content-Type': 'application/json' },
  };

  const searchRes = http.get(`${MARKETPLACE_BASE_URL}/search/filters?limit=20`, {
    tags: { name: 'search_filters' },
  });
  check(searchRes, { 'search succeeded': (r) => r.status === 200 });

  // Deterministic per-VU assignment (not random-per-iteration) so the
  // fraction of NL-search traffic is stable across the whole run, easier
  // to reason about against Groq's rate limit than a per-call coin flip.
  if (__VU % Math.round(1 / NL_SEARCH_BUYER_FRACTION) === 0) {
    const q = NL_QUERIES[__ITER % NL_QUERIES.length];
    const nlRes = http.get(`${MARKETPLACE_BASE_URL}/search/nl?q=${encodeURIComponent(q)}`, {
      tags: { name: 'nl_search' },
    });
    check(nlRes, { 'nl search succeeded': (r) => r.status === 200 });
  }

  const detailRes = http.get(`${MARKETPLACE_BASE_URL}/search/vehicles/${data.vehicleId}`, {
    tags: { name: 'vehicle_detail' },
  });
  check(detailRes, { 'vehicle detail succeeded': (r) => r.status === 200 });

  const favRes = http.get(`${MARKETPLACE_BASE_URL}/favourites`, {
    ...authHeaders,
    tags: { name: 'get_favourites' },
  });
  check(favRes, { 'get favourites succeeded': (r) => r.status === 200 });

  const saveRes = http.post(`${MARKETPLACE_BASE_URL}/favourites/${data.vehicleId}`, null, {
    ...authHeaders,
    tags: { name: 'save_favourite' },
  });
  check(saveRes, { 'save favourite succeeded': (r) => r.status === 200 || r.status === 201 });

  http.del(`${MARKETPLACE_BASE_URL}/favourites/${data.vehicleId}`, null, {
    ...authHeaders,
    tags: { name: 'remove_favourite' },
  });

  sleep(1);
}

/** dealer_ingestion scenario: each of NUM_DEALERS VUs uploads its own file once, then polls to completion. */
export function dealerIngestion(data) {
  const dealerIndex = exec.scenario.iterationInTest;
  const dealer = data.dealers[dealerIndex];

  let csv;
  let zip = null;
  if (DEALER_UPLOAD_IMAGES > 0) {
    // Pre-generated pair: ZIP entry filenames already match this CSV's rows.
    csv = DEALER_FIXTURES[dealerIndex].csv;
    zip = DEALER_FIXTURES[dealerIndex].zip;
  } else {
    csv = buildInlineCsv(dealer.regPrefix, DEALER_UPLOAD_ROWS);
  }

  // A small, deterministic stagger per dealer so NUM_DEALERS uploads don't
  // all submit in the exact same tick - "several dealers uploading around
  // the same time", not "the identical millisecond", matching how real
  // concurrent dealer activity would actually land.
  sleep(dealerIndex * 0.5);

  const uploadStart = Date.now();
  const uploadRes = http.post(
    `${INGESTION_BASE_URL}/ingest/upload`,
    zip
      ? { csv: http.file(csv, 'inventory.csv', 'text/csv'), zip: http.file(zip, 'images.zip', 'application/zip') }
      : { csv: http.file(csv, 'inventory.csv', 'text/csv') },
    {
      headers: { Authorization: `Bearer ${dealer.token}` },
      tags: { name: 'ingest_upload' },
      timeout: '300s', // NUM_DEALERS multipart bodies land at once on one machine
    },
  );
  check(uploadRes, { 'upload accepted (202)': (r) => r.status === 202 });
  if (uploadRes.status !== 202) {
    console.error(`dealer_ingestion[${dealer.email}]: upload failed (status ${uploadRes.status}): ${uploadRes.body}`);
    return;
  }
  const jobId = JSON.parse(uploadRes.body).jobId;

  let status = 'PENDING';
  let pollCount = 0;
  // 2s per poll; ceiling leaves 30s of headroom inside the scenario's maxDuration.
  const maxPolls = Math.floor((PRESET.dealerMaxSec - 30) / 2);
  while (!['COMPLETED', 'PARTIAL', 'FAILED'].includes(status) && pollCount < maxPolls) {
    sleep(2);
    const statusRes = http.get(`${INGESTION_BASE_URL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${dealer.token}` },
      tags: { name: 'job_status_poll' },
    });
    if (statusRes.status === 200) status = JSON.parse(statusRes.body).status;
    pollCount += 1;
  }

  const completionMs = Date.now() - uploadStart;
  jobCompletionTrend.add(completionMs);
  check(status, {
    'ingestion job reached a terminal, non-FAILED state': (s) => s === 'COMPLETED' || s === 'PARTIAL',
  });

  console.log(
    `dealer_ingestion[${dealer.email}]: job ${jobId} reached ${status} in ` +
      `${(completionMs / 1000).toFixed(1)}s while buyer_traffic was running (${pollCount} polls, ` +
      `${DEALER_UPLOAD_ROWS} rows, ${DEALER_UPLOAD_IMAGES} images)`,
  );
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'end-to-end-load made zero HTTP requests - every iteration threw before any request fired ' +
        '(check the k6 error log above and setup()).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
