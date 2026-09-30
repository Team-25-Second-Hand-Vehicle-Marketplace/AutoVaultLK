import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

/**
 * Admin service load test — never exercised at any concurrency by any
 * earlier script in this repo (every prior admin-service interaction was a
 * single Playwright browser session or a single k6 setup() call to approve
 * one dealer). Covers the read-heavy screens an admin actually spends time
 * on: dashboard, user list, uploads list, audit logs.
 *
 * Reuses ONE real admin login across N concurrent virtual sessions, rather
 * than registering N distinct admin accounts: admin-service is a small,
 * fixed-size operations team's tool, not a public-facing surface with many
 * independent accounts — the realistic scenario is several admin staff
 * viewing the SAME dashboard at the same time, sharing the one seeded
 * admin identity, not N different admins. (Contrast with buyer/dealer load
 * tests, which correctly register N distinct accounts because that IS the
 * realistic shape of buyer/dealer traffic.)
 *
 * NUM_ADMIN_SESSIONS defaults to 10 — no NFR in the SRS specifies a target
 * concurrent-admin-session count the way NFR-10 does for buyers; 10 is a
 * reasonable stand-in for "the whole admin/ops team looking at this at
 * once," not a documented requirement.
 */

const ADMIN_BASE_URL = __ENV.ADMIN_BASE_URL || 'http://localhost:3004';
const AUTH_BASE_URL = __ENV.AUTH_BASE_URL || 'http://localhost:3001';
const ADMIN_EMAIL = __ENV.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = __ENV.ADMIN_SEED_PASSWORD;

const NUM_ADMIN_SESSIONS = Number(__ENV.NUM_ADMIN_SESSIONS || 10);

export const options = {
  scenarios: {
    admin_traffic: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: NUM_ADMIN_SESSIONS },
        { duration: '1m', target: NUM_ADMIN_SESSIONS },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    // NFR-09: CRUD/browse APIs under 500ms p95 — admin screens are exactly
    // this category (read-heavy list/dashboard views), so the same bar
    // applies even though the SRS never names admin-service specifically.
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
  setupTimeout: '1m',
};

export function setup() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      'setup: ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD must be set in the environment running this script.',
    );
  }

  const loginRes = http.post(
    `${AUTH_BASE_URL}/auth/login/admin`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (loginRes.status !== 200 && loginRes.status !== 201) {
    throw new Error(`setup: admin login failed (status ${loginRes.status})`);
  }

  return { adminToken: JSON.parse(loginRes.body).accessToken };
}

export default function (data) {
  const authHeaders = { headers: { Authorization: `Bearer ${data.adminToken}` } };

  const dashboardRes = http.get(`${ADMIN_BASE_URL}/admin/dashboard`, {
    ...authHeaders,
    tags: { name: 'admin_dashboard' },
  });
  check(dashboardRes, { 'dashboard succeeded': (r) => r.status === 200 });

  // None of these three endpoints takes a `limit` query param — listUsers
  // and listUploads return their full (unpaginated) set filtered only by
  // an optional status, and audit-logs search is internally fixed to the
  // latest 200 (AuditLogsRepository.search's own .take(200)) — confirmed
  // by reading admin.controller.ts's DTOs before guessing at query shapes.
  const usersRes = http.get(`${ADMIN_BASE_URL}/admin/users`, {
    ...authHeaders,
    tags: { name: 'admin_users' },
  });
  check(usersRes, { 'users list succeeded': (r) => r.status === 200 });

  const uploadsRes = http.get(`${ADMIN_BASE_URL}/admin/uploads`, {
    ...authHeaders,
    tags: { name: 'admin_uploads' },
  });
  check(uploadsRes, { 'uploads list succeeded': (r) => r.status === 200 });

  const auditRes = http.get(`${ADMIN_BASE_URL}/admin/audit-logs`, {
    ...authHeaders,
    tags: { name: 'admin_audit_logs' },
  });
  check(auditRes, { 'audit logs succeeded': (r) => r.status === 200 });

  sleep(1);
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'admin-service-load made zero HTTP requests — every iteration threw before any request ' +
        'fired (check the k6 error log above and setup()).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
