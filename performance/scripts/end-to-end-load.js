import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import encoding from 'k6/encoding';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

/**
 * End-to-end concurrent load: the realistic mixed-traffic scenario —
 * multiple buyers searching/browsing/favouriting (via both filtered AND
 * natural-language search) AND multiple dealers each bulk-uploading
 * inventory, all running in the SAME k6 process at the SAME time, against
 * the SAME database. This is the specific risk the Test Plan names as the
 * reason Load Testing exists as its own technique (§3.3.5): "The risk is
 * therefore not that either fails alone, but that one dealer uploading a
 * large inventory degrades search for every concurrent buyer" — extended
 * here to several dealers uploading at once, not just one, since that is
 * the more realistic "everything happening together" shape of production
 * traffic, not a single isolated actor.
 *
 * Three independent k6 scenarios, run concurrently by k6's own scheduler:
 *   - buyer_traffic: NUM_BUYERS concurrent buyers, each looping through
 *     filtered search -> vehicle detail -> favourite. A small fraction
 *     (NL_SEARCH_BUYER_FRACTION) also issue a natural-language search each
 *     iteration — capped deliberately: NL search hits a REAL external Groq
 *     API call with no client-side rate limiting (confirmed by inspection
 *     of groq-fallback.service.ts), and every one of NUM_BUYERS VUs firing
 *     NL search concurrently risks tripping Groq's own account rate limit,
 *     which would produce a false failure signal about Groq, not about
 *     AutoVaultLK. Only some buyers using NL search is also the more
 *     realistic mix — most real searches are filtered, not natural-language.
 *   - dealer_ingestion: NUM_DEALERS dealers, each uploading their own file
 *     concurrently, staggered slightly so they don't all submit in the
 *     same tick — the risk under test is "N dealers uploading around the
 *     same time", not "N dealers submitting the exact same millisecond".
 *
 * Thresholds are scoped PER SCENARIO via tag filters: buyer-facing calls
 * are gated on NFR-09 (p95<500ms) even while multiple dealers ingest
 * concurrently — that is the actual pass/fail question this script
 * answers. Ingestion jobs' own completion times have no NFR to gate on
 * (same reasoning as dealer-ingestion-baseline.js) and are reported only.
 *
 * Points at local services by default; override AUTH_BASE_URL /
 * MARKETPLACE_BASE_URL / INGESTION_BASE_URL / ADMIN_BASE_URL to run the
 * exact same script against a deployed environment — no separate
 * staging copy of this file is needed.
 */

const AUTH_BASE_URL = __ENV.AUTH_BASE_URL || 'http://localhost:3001';
const MARKETPLACE_BASE_URL = __ENV.MARKETPLACE_BASE_URL || 'http://localhost:3002';
const INGESTION_BASE_URL = __ENV.INGESTION_BASE_URL || 'http://localhost:3003';
const ADMIN_BASE_URL = __ENV.ADMIN_BASE_URL || 'http://localhost:3004';
const ADMIN_EMAIL = __ENV.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = __ENV.ADMIN_SEED_PASSWORD;

const NUM_BUYERS = Number(__ENV.NUM_BUYERS || 50); // NFR-10's stated concurrent-buyer-session target
const NUM_DEALERS = Number(__ENV.NUM_DEALERS || 3); // multiple dealers uploading concurrently, not just one
const NL_SEARCH_BUYER_FRACTION = 0.2; // ~1 in 5 buyers also issues an NL search each iteration

export const options = {
  scenarios: {
    buyer_traffic: {
      executor: 'ramping-vus',
      exec: 'buyerTraffic',
      startVUs: 0,
      stages: [
        { duration: '20s', target: NUM_BUYERS },
        { duration: '2m', target: NUM_BUYERS },
        { duration: '20s', target: 0 },
      ],
    },
    dealer_ingestion: {
      executor: 'per-vu-iterations',
      exec: 'dealerIngestion',
      vus: NUM_DEALERS,
      iterations: 1,
      // Starts 30s in, so uploads overlap buyer_traffic's hold stage
      // rather than racing its own ramp-up.
      startTime: '30s',
      maxDuration: '2m',
    },
  },
  thresholds: {
    'http_req_duration{name:search_filters}': ['p(95)<500'],
    'http_req_duration{name:vehicle_detail}': ['p(95)<500'],
    'http_req_duration{name:get_favourites}': ['p(95)<500'],
    'http_req_duration{name:save_favourite}': ['p(95)<500'],
    // NL search is gated on the SRS's own 2s warm-start figure (NFR-09),
    // not the 500ms CRUD/browse bar — same reasoning as nl-search-baseline.js.
    'http_req_duration{name:nl_search}': ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
  // (NUM_BUYERS + NUM_DEALERS) sequential-ish account registrations, each
  // several HTTP round trips (and dealers additionally need a document
  // upload + admin approval round trip) — batched via http.batch() below
  // to keep this from reproducing the earlier multi-minute sequential
  // setup() delay, but still given a generous ceiling.
  setupTimeout: '4m',
};

const DOCUMENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const CSV_HEADER =
  'registration_number,make,model,year,price,mileage,fuel_type,transmission,color,engine_capacity_cc,owners_count,location_district';

const jobCompletionTrend = new Trend('ingestion_job_completion_ms', true);

const NL_QUERIES = [
  'red Toyota Aqua under 6 million',
  'cheap manual petrol car in Colombo',
  'Honda Civic 2018 or newer',
];

/**
 * Registers NUM_BUYERS buyer accounts and NUM_DEALERS verified business
 * dealer accounts before either scenario starts, so all registration/
 * verification/approval cost stays out of the measured windows.
 *
 * Uses http.batch() for the registration calls themselves (the genuinely
 * expensive, independent part — each does a real bcrypt.hash + DB write
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
  for (let i = 0; i < NUM_BUYERS; i++) {
    buyerRegisterRequests.push([
      'POST',
      `${AUTH_BASE_URL}/auth/register/buyer`,
      JSON.stringify({
        name: `k6 E2E Buyer ${i}`,
        email: `k6-e2e-buyer-${stamp}-${i}@example.test`,
        password: 'Passw0rd!23',
      }),
      { headers: { 'Content-Type': 'application/json' } },
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
        'setup: POST /auth/register/buyer did not return verificationToken — ' +
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
  const buyerVerifyRequests = buyers.map((b) => [
    'POST',
    `${AUTH_BASE_URL}/auth/email/verify`,
    JSON.stringify({ token: b.verificationToken }),
    { headers: { 'Content-Type': 'application/json' } },
  ]);
  const buyerVerifyResponses = http.batch(buyerVerifyRequests);
  buyerVerifyResponses.forEach((res, i) => {
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`setup: verification failed for buyer ${i} (status ${res.status})`);
    }
  });

  const searchRes = http.get(`${MARKETPLACE_BASE_URL}/search/filters?limit=1`);
  if (searchRes.status !== 200) {
    throw new Error(`setup: could not fetch a vehicle id (status ${searchRes.status})`);
  }
  const items = JSON.parse(searchRes.body).items;
  if (!items || items.length === 0) {
    throw new Error('setup: local catalogue is empty — is it seeded (database/ seed:vehicles)?');
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
      { headers: { 'Content-Type': 'application/json' } },
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

  const dealerVerifyRequests = dealers.map((d) => [
    'POST',
    `${AUTH_BASE_URL}/auth/email/verify`,
    JSON.stringify({ token: d.verificationToken }),
    { headers: { 'Content-Type': 'application/json' } },
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

  const dealerLoginRequests = dealers.map((d) => [
    'POST',
    `${AUTH_BASE_URL}/auth/login`,
    JSON.stringify({ email: d.email, password: d.password }),
    { headers: { 'Content-Type': 'application/json' } },
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
 * fraction also issue NL search. Every path ends in sleep(1), including
 * the early-return failure paths below — see buyer-traffic-stress.js for
 * why: a VU whose login fails and returns immediately with no sleep spins
 * in a near-zero-cost tight loop instead of behaving like a paced session.
 */
export function buyerTraffic(data) {
  const buyer = data.buyers[(__VU - 1) % data.buyers.length];

  if (__ITER === 0) {
    const loginRes = http.post(
      `${AUTH_BASE_URL}/auth/login`,
      JSON.stringify({ email: buyer.email, password: buyer.password }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
    );
    check(loginRes, { 'login succeeded': (r) => r.status === 200 || r.status === 201 });
    if (loginRes.status !== 200 && loginRes.status !== 201) {
      sleep(1);
      return;
    }
    buyer.accessToken = JSON.parse(loginRes.body).accessToken;
  }
  if (!buyer.accessToken) {
    sleep(1);
    return;
  }

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
  const dealer = data.dealers[__VU - 1];

  const csv = [
    CSV_HEADER,
    `${dealer.regPrefix}-1,Toyota,Corolla,2020,5500000,45000,Petrol,Automatic,White,1500,1,Colombo`,
    `${dealer.regPrefix}-2,Honda,Civic,2019,4200000,60000,Petrol,Manual,Black,1600,1,Kandy`,
  ].join('\n') + '\n';

  // A small, deterministic stagger per dealer so NUM_DEALERS uploads don't
  // all submit in the exact same tick — "several dealers uploading around
  // the same time", not "the identical millisecond", matching how real
  // concurrent dealer activity would actually land.
  sleep((__VU - 1) * 0.5);

  const uploadStart = Date.now();
  const uploadRes = http.post(
    `${INGESTION_BASE_URL}/ingest/upload`,
    { csv: http.file(csv, 'inventory.csv', 'text/csv') },
    { headers: { Authorization: `Bearer ${dealer.token}` }, tags: { name: 'ingest_upload' } },
  );
  check(uploadRes, { 'upload accepted (202)': (r) => r.status === 202 });
  if (uploadRes.status !== 202) {
    console.error(`dealer_ingestion[${dealer.email}]: upload failed (status ${uploadRes.status}): ${uploadRes.body}`);
    return;
  }
  const jobId = JSON.parse(uploadRes.body).jobId;

  let status = 'PENDING';
  let pollCount = 0;
  const maxPolls = 45; // 45 * 2s = 90s ceiling, inside this scenario's 2m maxDuration
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
      `${(completionMs / 1000).toFixed(1)}s while buyer_traffic was running (${pollCount} polls)`,
  );
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'end-to-end-load made zero HTTP requests — every iteration threw before any request fired ' +
        '(check the k6 error log above and setup()).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
