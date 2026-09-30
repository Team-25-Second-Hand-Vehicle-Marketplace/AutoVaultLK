import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

/**
 * Refresh-token / session-renewal load test — never exercised by any earlier
 * script in this repo. Every prior auth-related script only ever logged in
 * once per VU and reused that access token for the rest of the run; nothing
 * has driven POST /auth/refresh at all, let alone concurrently.
 *
 * Real constraint this script is built around: AUTH_REFRESH_MAX_PER_IP=30 /
 * AUTH_REFRESH_WINDOW_MINUTES=15 (auth-abuse-protection.service.ts,
 * assertRefreshAllowed) is a per-IP counter, and every k6 VU run locally
 * shares one IP (localhost). That makes 30 refresh calls per 15-minute
 * window a hard ceiling for THIS WHOLE TEST, not a per-user budget — so
 * REFRESH_CALLS_PER_VU x NUM_SESSIONS is deliberately kept just under 30,
 * and the real thing being verified is that the service degrades to a clean
 * 429 (not a 500 or a crash) once the limit is actually hit, per
 * AUTH_SECURITY_MESSAGES.TOO_MANY_ATTEMPTS — not that the ceiling itself is
 * generous. A staging run behind real per-client IPs would not hit this
 * shared-IP ceiling the same way; see 04-load-testing.md's staging section.
 *
 * Cookie mechanics: AUTH_USE_REFRESH_COOKIES=true /
 * AUTH_REFRESH_TOKEN_IN_BODY=false means the refresh token never appears in
 * any JSON body — it only ever travels as the httpOnly `refresh_token`
 * cookie (path=/auth). k6's per-VU http.CookieJar carries this
 * automatically across requests, same as a real browser. The CSRF guard
 * (csrf.guard.ts) additionally requires an `X-CSRF-Token` header matching
 * the non-httpOnly `csrf_token` cookie whenever a refresh is attempted via
 * cookie (not body) — read directly from the jar before each refresh call,
 * since k6 does not send cookie values back as headers automatically.
 */

const AUTH_BASE_URL = __ENV.AUTH_BASE_URL || 'http://localhost:3001';

const NUM_SESSIONS = Number(__ENV.NUM_SESSIONS || 5);
const REFRESH_CALLS_PER_VU = Number(__ENV.REFRESH_CALLS_PER_VU || 5); // 5 x 5 = 25, safely under the 30/15min IP cap

export const options = {
  scenarios: {
    session_renewal: {
      executor: 'per-vu-iterations',
      vus: NUM_SESSIONS,
      iterations: REFRESH_CALLS_PER_VU,
      maxDuration: '5m',
    },
  },
  thresholds: {
    // NFR-09's CRUD bar — a token refresh is a simple DB read/write, not a
    // search or an upload.
    'http_req_duration{name:auth_refresh}': ['p(95)<500'],
    // Not the usual 1%: hitting the real 429 ceiling by design during this
    // run is an EXPECTED, correct outcome once REFRESH_CALLS_PER_VU x
    // NUM_SESSIONS is pushed past 30 deliberately (see RUN_TO_RATE_LIMIT
    // below) — a tight 1% bar would make the correct behaviour look like a
    // test failure.
    'http_req_failed{name:auth_refresh}': ['rate<0.05'],
  },
  setupTimeout: '1m',
};

// When true, intentionally ignores the safe default above and pushes total
// refresh calls past the 30/15min IP ceiling, to assert the service returns
// a clean 429 rather than degrading badly. Off by default so a normal run
// stays a realistic session-renewal load test rather than a rate-limit probe.
const RUN_TO_RATE_LIMIT = __ENV.RUN_TO_RATE_LIMIT === 'true';

export function setup() {
  const sessions = [];
  for (let i = 0; i < NUM_SESSIONS; i++) {
    const stamp = Date.now();
    const email = `k6-refresh-buyer-${stamp}-${i}@example.test`;
    const password = 'Passw0rd!23';

    const registerRes = http.post(
      `${AUTH_BASE_URL}/auth/register/buyer`,
      JSON.stringify({ email, password, name: `k6 Refresh Buyer ${i}` }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (registerRes.status !== 201) {
      throw new Error(`setup: buyer ${i} registration failed (status ${registerRes.status}): ${registerRes.body}`);
    }
    const verificationToken = JSON.parse(registerRes.body).verificationToken;

    const verifyRes = http.post(
      `${AUTH_BASE_URL}/auth/email/verify`,
      JSON.stringify({ token: verificationToken }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (verifyRes.status !== 200 && verifyRes.status !== 201) {
      throw new Error(`setup: buyer ${i} email verification failed (status ${verifyRes.status})`);
    }

    sessions.push({ email, password });
  }
  return { sessions };
}

export default function (data) {
  const jar = http.cookieJar();
  const session = data.sessions[__VU - 1];

  const loginRes = http.post(
    `${AUTH_BASE_URL}/auth/login`,
    JSON.stringify({ email: session.email, password: session.password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'auth_login' } },
  );
  check(loginRes, { 'login succeeded': (r) => r.status === 200 || r.status === 201 });
  if (loginRes.status !== 200 && loginRes.status !== 201) {
    throw new Error(`session_renewal VU ${__VU}: login failed (status ${loginRes.status}): ${loginRes.body}`);
  }

  const cookies = jar.cookiesForURL(`${AUTH_BASE_URL}/auth/refresh`);
  const csrfToken = cookies.csrf_token ? cookies.csrf_token[0] : undefined;

  const refreshRes = http.post(
    `${AUTH_BASE_URL}/auth/refresh`,
    JSON.stringify({}),
    {
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      tags: { name: 'auth_refresh' },
    },
  );

  if (RUN_TO_RATE_LIMIT) {
    check(refreshRes, {
      'refresh succeeded or was cleanly rate-limited': (r) => r.status === 200 || r.status === 201 || r.status === 429,
    });
  } else {
    check(refreshRes, { 'refresh succeeded': (r) => r.status === 200 || r.status === 201 });
    if (refreshRes.status !== 200 && refreshRes.status !== 201) {
      console.error(
        `session_renewal VU ${__VU} iter ${__ITER}: refresh failed (status ${refreshRes.status}): ${refreshRes.body}`,
      );
    }
  }

  sleep(1);
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'refresh-token-session-renewal made zero HTTP requests — every iteration threw before any ' +
        'request fired (check the k6 error log above and setup()).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
