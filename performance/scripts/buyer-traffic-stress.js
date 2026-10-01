import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

/**
 * Stress test: ramps buyer concurrency PAST NFR-10's 50-session target,
 * with no pre-chosen ceiling, to find the actual saturation point - the
 * Test Plan's own definition (§3.3.5): "concurrency ramped past expected
 * peak to locate the saturation point and confirm the system degrades via
 * queueing, throttling or clear errors rather than opaque failure."
 *
 * Deliberately NO http_req_duration threshold gating this run: a stress
 * test's whole point is to go past where the system is expected to still
 * meet its normal targets, so failing NFR-09's 500ms bar at 200+ VUs is
 * not a bug this script should flag - it's the expected, useful outcome.
 * The only thing gated is http_req_failed, and even that is set generous
 * (10%, not 1%) - some failures under deliberate overload are the correct
 * signal, not noise; a 0%-failure stress test would mean the ramp never
 * actually found the ceiling.
 *
 * No ingestion mixed in here (unlike end-to-end-load.js) - stress testing
 * isolates ONE variable (buyer concurrency) so a saturation point found
 * here is attributable to buyer load alone, not entangled with a
 * concurrent dealer upload. The interaction between the two is what
 * end-to-end-load.js already covers separately.
 *
 * Read the console output and the per-stage p95/error-rate trend after a
 * run to find where degradation actually starts - that number is the
 * point of this script, not a pass/fail verdict on the numbers file.
 */

const AUTH_BASE_URL = __ENV.AUTH_BASE_URL || 'http://localhost:3001';
const MARKETPLACE_BASE_URL = __ENV.MARKETPLACE_BASE_URL || 'http://localhost:3002';

// The ramp goes well past NFR-10's 50-session target in stages, holding
// briefly at each so a stage's own p95 is legible in the per-stage
// breakdown rather than blurred into a single ramp-to-ramp average.
//
// Stage targets are FRACTIONS of MAX_VUS, not hardcoded literals: an
// earlier version hardcoded 50/100/200/MAX_VUS, which produced a
// non-monotonic ramp (50->100->200->100->0) the one time this was run
// with MAX_VUS=100 for a quick sanity check, since 200 > 100. Scaling
// every stage off MAX_VUS keeps the ramp monotonically increasing
// regardless of what MAX_VUS is overridden to.
const MAX_VUS = Number(__ENV.MAX_VUS || 400);
const quarter = Math.max(1, Math.round(MAX_VUS / 4));

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: quarter },
        { duration: '30s', target: quarter },
        { duration: '20s', target: quarter * 2 },
        { duration: '30s', target: quarter * 2 },
        { duration: '20s', target: quarter * 3 },
        { duration: '30s', target: quarter * 3 },
        { duration: '20s', target: MAX_VUS },
        { duration: '30s', target: MAX_VUS },
        { duration: '30s', target: 0 }, // ramp down
      ],
    },
  },
  thresholds: {
    // Generous, deliberately: some failure under overload is the expected
    // signal a stress test exists to find, not something to suppress.
    http_req_failed: ['rate<0.10'],
  },
  setupTimeout: '5m',
};

// A smaller, reused pool rather than one account per VU: MAX_VUS accounts
// registered via one giant http.batch() call is itself a 400-way
// concurrent burst against the registration endpoint (each doing a real
// bcrypt.hash server-side) - confirmed by direct observation to make
// setup() itself the bottleneck (avg registration response time rose to
// 3.58s under a 298-wide batch, well past what a single VU sees). This
// script is meant to stress BROWSING concurrency, not registration
// concurrency, so a fixed, smaller pool of real accounts is reused across
// VUs (several VUs sharing one login) - realistic enough for a browsing
// stress test, and keeps setup() itself fast regardless of how high
// MAX_VUS goes.
const ACCOUNT_POOL_SIZE = 50;

export function setup() {
  const stamp = Date.now();
  const buyers = [];
  const registerRequests = [];
  for (let i = 0; i < ACCOUNT_POOL_SIZE; i++) {
    registerRequests.push([
      'POST',
      `${AUTH_BASE_URL}/auth/register/buyer`,
      JSON.stringify({
        name: `k6 Stress Buyer ${i}`,
        email: `k6-stress-buyer-${stamp}-${i}@example.test`,
        password: 'Passw0rd!23',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    ]);
  }
  const registerResponses = http.batch(registerRequests);

  registerResponses.forEach((res, i) => {
    if (res.status !== 201) {
      throw new Error(`setup: registration failed for buyer ${i} (status ${res.status})`);
    }
    const body = JSON.parse(res.body);
    if (!body.verificationToken) {
      throw new Error(
        'setup: POST /auth/register/buyer did not return verificationToken - ' +
          'is AUTH_RETURN_VERIFICATION_TOKEN=true set?',
      );
    }
    buyers.push({
      email: `k6-stress-buyer-${stamp}-${i}@example.test`,
      password: 'Passw0rd!23',
      verificationToken: body.verificationToken,
    });
  });

  const verifyRequests = buyers.map((b) => [
    'POST',
    `${AUTH_BASE_URL}/auth/email/verify`,
    JSON.stringify({ token: b.verificationToken }),
    { headers: { 'Content-Type': 'application/json' } },
  ]);
  http.batch(verifyRequests).forEach((res, i) => {
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
    throw new Error('setup: local catalogue is empty - is it seeded (database/ seed:vehicles)?');
  }

  return { buyers, vehicleId: items[0].id };
}

export default function (data) {
  // Every path through this function ends in sleep(1), including the
  // early-return failure paths below - confirmed by direct observation
  // that omitting it on those paths let a VU whose login failed spin in a
  // near-zero-cost tight loop: one run recorded 43 MILLION iterations in
  // under 4 minutes from just 46 failed logins out of 400 VUs, which also
  // explains that run's runaway CPU pressure on the k6 process itself
  // rather than reflecting real server load.
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

  const searchRes = http.get(`${MARKETPLACE_BASE_URL}/search/filters?limit=20`, {
    tags: { name: 'search_filters' },
  });
  check(searchRes, { 'search succeeded': (r) => r.status === 200 });

  const detailRes = http.get(`${MARKETPLACE_BASE_URL}/search/vehicles/${data.vehicleId}`, {
    tags: { name: 'vehicle_detail' },
  });
  check(detailRes, { 'vehicle detail succeeded': (r) => r.status === 200 });

  sleep(1);
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'buyer-traffic-stress made zero HTTP requests - every iteration threw before any request ' +
        'fired (check the k6 error log above and setup()).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
