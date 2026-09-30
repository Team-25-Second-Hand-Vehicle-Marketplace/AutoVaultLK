import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

/**
 * Concurrent LOAD test (not a baseline): authenticated buyer traffic —
 * login once, then repeatedly call GET /favourites under real concurrency.
 * NFR-10 (SRS): the system shall support at least 50 concurrent buyer
 * sessions without degraded response times — this ramps to exactly that.
 *
 * Login itself is deliberately NOT the repeated action under load. Each VU
 * logs in exactly ONCE, in its own setup, then reuses that access token for
 * the rest of the run. Two independent reasons:
 *
 * 1. auth-user-service's AuthAbuseProtectionService rate-limits an IP after
 *    repeated FAILED login attempts (assertIpRateLimit ->
 *    countRecentByIp(..., success=false) — see auth-abuse-protection.service.ts).
 *    All 50 VUs originate from k6's own IP; a script that logged in on every
 *    iteration would still be safe from that specific limiter as long as
 *    every attempt succeeds, but re-authenticating every iteration would
 *    measure login-endpoint throughput, not "50 concurrent buyer sessions
 *    browsing" — a different transaction than what NFR-10 describes.
 * 2. A single shared test account across 50 VUs would still be safe against
 *    the per-account lockout (successes don't count toward it either), but
 *    it would serialise nothing meaningful — it's not what "50 concurrent
 *    buyer SESSIONS" means. Each VU gets its OWN distinct, real,
 *    pre-registered and pre-verified buyer account instead.
 *
 * setup() runs once, before any VU/iteration, and pre-registers NUM_VUS
 * real buyer accounts via the same AUTH_RETURN_VERIFICATION_TOKEN
 * mechanism the Playwright suite (e2e/tests/buyer-registration.spec.ts)
 * and auth-user-service's own e2e harness both rely on — no new backend
 * affordance added for this script.
 */

const AUTH_BASE_URL = __ENV.AUTH_BASE_URL || 'http://localhost:3001';
const MARKETPLACE_BASE_URL = __ENV.MARKETPLACE_BASE_URL || 'http://localhost:3002';

const NUM_VUS = 50; // NFR-10's stated concurrent-buyer-session target

export const options = {
  scenarios: {
    concurrent_buyers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: NUM_VUS }, // ramp up to NFR-10's 50
        { duration: '2m', target: NUM_VUS }, // hold at 50 concurrent sessions
        { duration: '30s', target: 0 }, // ramp down
      ],
    },
  },
  thresholds: {
    // NFR-09: average API response time under 500ms for CRUD/browse APIs.
    // p(95) is the stricter, more representative bar — see config.js.
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

/** Registers and verifies one real buyer account, returning its credentials. */
function registerVerifiedBuyer(index) {
  const stamp = Date.now();
  const email = `k6-load-buyer-${stamp}-${index}@example.test`;
  const password = 'Passw0rd!23';

  const registerRes = http.post(
    `${AUTH_BASE_URL}/auth/register/buyer`,
    JSON.stringify({ name: `k6 Load Buyer ${index}`, email, password }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (registerRes.status !== 201) {
    throw new Error(
      `setup: registration failed for VU ${index} (status ${registerRes.status}): ${registerRes.body}`,
    );
  }

  const body = JSON.parse(registerRes.body);
  if (!body.verificationToken) {
    throw new Error(
      'setup: POST /auth/register/buyer did not return verificationToken — ' +
        'is AUTH_RETURN_VERIFICATION_TOKEN=true set on the running auth-user-service?',
    );
  }

  const verifyRes = http.post(
    `${AUTH_BASE_URL}/auth/email/verify`,
    JSON.stringify({ token: body.verificationToken }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (verifyRes.status !== 200 && verifyRes.status !== 201) {
    throw new Error(
      `setup: email verification failed for VU ${index} (status ${verifyRes.status}): ${verifyRes.body}`,
    );
  }

  return { email, password };
}

/**
 * Runs once before any VU starts iterating. Pre-registering here rather
 * than in each VU's first iteration keeps registration — which is itself
 * rate-limited and has its own cost — out of the measured load window
 * entirely; only the authenticated GET /favourites calls below are timed
 * against the NFR-09 threshold.
 */
export function setup() {
  const buyers = [];
  for (let i = 0; i < NUM_VUS; i++) {
    buyers.push(registerVerifiedBuyer(i));
  }

  // One real vehicle id, for the favourites POST/DELETE cycle each VU
  // exercises alongside the read path.
  const searchRes = http.get(`${MARKETPLACE_BASE_URL}/search/filters?limit=1`);
  if (searchRes.status !== 200) {
    throw new Error(`setup: could not fetch a vehicle id (status ${searchRes.status})`);
  }
  const items = JSON.parse(searchRes.body).items;
  if (!items || items.length === 0) {
    throw new Error('setup: local catalogue is empty — is it seeded (database/ seed:vehicles)?');
  }

  return { buyers, vehicleId: items[0].id };
}

/**
 * Each VU calls this once per iteration during the ramp/hold/ramp-down
 * stages. __VU is k6's 1-indexed virtual user number; buyers[] is 0-indexed
 * and sized to NUM_VUS, so this assumes VU count never exceeds NUM_VUS —
 * true here since the executor's target is NUM_VUS itself.
 */
export default function (data) {
  const buyer = data.buyers[(__VU - 1) % data.buyers.length];

  // Login happens once per VU (k6 caches nothing between iterations by
  // default, so this file-scope guard is what makes it "once"): __ITER is
  // 0 on a VU's first iteration only.
  if (__ITER === 0) {
    const loginRes = http.post(
      `${AUTH_BASE_URL}/auth/login`,
      JSON.stringify({ email: buyer.email, password: buyer.password }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
    );

    check(loginRes, { 'login succeeded': (r) => r.status === 200 || r.status === 201 });
    if (loginRes.status !== 200 && loginRes.status !== 201) {
      // A failed login means nothing else this VU does is authenticated —
      // no point continuing this iteration. sleep(1) still runs first: an
      // early return with no sleep lets this VU spin in a near-zero-cost
      // tight loop instead of behaving like a paced session (confirmed by
      // direct observation in buyer-traffic-stress.js: 46 failed logins
      // out of 400 VUs produced 43 million iterations in under 4 minutes
      // from exactly this gap).
      sleep(1);
      return;
    }

    buyer.accessToken = JSON.parse(loginRes.body).accessToken;
  }

  if (!buyer.accessToken) {
    sleep(1); // same reasoning as above
    return;
  }

  const authHeaders = {
    headers: {
      Authorization: `Bearer ${buyer.accessToken}`,
      'Content-Type': 'application/json',
    },
  };

  // The read path NFR-10 actually describes: a signed-in buyer browsing.
  const favouritesRes = http.get(
    `${MARKETPLACE_BASE_URL}/favourites`,
    { ...authHeaders, tags: { name: 'get_favourites' } },
  );
  check(favouritesRes, { 'get favourites succeeded': (r) => r.status === 200 });

  // A save/unsave cycle, so the load includes a write path too, not reads only.
  const saveRes = http.post(
    `${MARKETPLACE_BASE_URL}/favourites/${data.vehicleId}`,
    null,
    { ...authHeaders, tags: { name: 'save_favourite' } },
  );
  check(saveRes, {
    'save favourite succeeded': (r) => r.status === 200 || r.status === 201,
  });

  const removeRes = http.del(
    `${MARKETPLACE_BASE_URL}/favourites/${data.vehicleId}`,
    null,
    { ...authHeaders, tags: { name: 'remove_favourite' } },
  );
  check(removeRes, { 'remove favourite succeeded': (r) => r.status === 200 });

  sleep(1); // a real buyer session paces itself; without this every VU tight-loops
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'login-favourites-load made zero HTTP requests — every iteration threw before any ' +
        'request fired (check the k6 error log above and setup()), which the default summary ' +
        'reports as a false-positive pass.',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
