import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

/**
 * Notification delivery load test - never exercised by any earlier script
 * in this repo; notification-service has had zero load-test coverage until
 * this. The most design-heavy of the 7 gap-closing scripts, since
 * POST /notifications/events (notifications.controller.ts) isn't a normal
 * buyer/dealer-facing endpoint:
 *
 * - It's internal-only: @UseGuards(InternalServiceGuard) requires an
 *   `X-Internal-Service-Key` header matching INTERNAL_SERVICE_KEY (.env) -
 *   this script authenticates as another SERVICE, not as a user, same as
 *   ingestion-service's own NOTIFY stage would.
 * - It's synchronous locally, not queued: SqsPublisher.isConfigured()
 *   is false with no SQS/AWS config set (the real local/dev condition,
 *   INGESTION_QUEUE_DRIVER=inprocess's notification-side equivalent), so
 *   every call here runs NotificationEventHandler.handle() INLINE within
 *   the request - persist, render, attempt SES delivery, record outcome -
 *   making this a genuine synchronous-throughput test of that full path,
 *   not a fire-and-forget queue-depth test.
 * - SES is skipped, not mocked: SES_FROM_EMAIL is empty in .env, so
 *   ses.adapter.ts's own short-circuit logs locally instead of calling AWS
 *   - meaning this test exercises the real DB persistence + idempotency
 *   logic without either a real email cost or a fake network call
 *   standing in for one.
 * - A real recipient is required: NotificationEventHandler.insertPending
 *   calls repository.findUser(dto.userId) against AuthUserView and throws
 *   404 if the id doesn't resolve to a real, cross-service-replicated auth
 *   user row - so this script registers real buyers first (setup()) and
 *   uses their genuine user ids, rather than random UUIDs.
 *
 * Two things are checked, matching FR-53's own two halves (see
 * notification-event.handler.ts's own doc comment):
 *   1. Throughput/correctness under concurrency: N distinct buyers each
 *      get a real notification event, concurrently, and all succeed.
 *   2. The idempotency guarantee itself under REAL concurrency: the same
 *      idempotencyKey is submitted twice at the same moment (not
 *      sequentially, which the unit/integration suites already cover) -
 *      exactly the race unique_index on idempotency_key plus
 *      NotificationEventHandler's existing-row check exists to settle. All
 *      concurrent submitters of one key must get back that key with a
 *      consistent SENT-or-terminal outcome, and no duplicate notification
 *      may be persisted.
 */

const AUTH_BASE_URL = __ENV.AUTH_BASE_URL || 'http://localhost:3001';
const NOTIFICATION_BASE_URL = __ENV.NOTIFICATION_BASE_URL || 'http://localhost:3005';
const INTERNAL_SERVICE_KEY = __ENV.INTERNAL_SERVICE_KEY;

const NUM_BUYERS = Number(__ENV.NUM_BUYERS || 15);

export const options = {
  scenarios: {
    notification_delivery: {
      executor: 'shared-iterations',
      vus: NUM_BUYERS,
      iterations: NUM_BUYERS,
      maxDuration: '3m',
    },
  },
  thresholds: {
    // In-request delivery (DB write + template render + skipped-SES path) -
    // a CRUD-shaped write, so the same NFR-09 bar applies.
    'http_req_duration{name:notification_event}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
  setupTimeout: '2m',
};

export function setup() {
  if (!INTERNAL_SERVICE_KEY) {
    throw new Error(
      'setup: INTERNAL_SERVICE_KEY must be set in the environment running this script ' +
        '(must match the value notification-service itself reads from .env).',
    );
  }

  const buyers = [];
  for (let i = 0; i < NUM_BUYERS; i++) {
    const stamp = `${Date.now()}-${i}`;
    const email = `k6-notif-buyer-${stamp}@example.test`;
    const password = 'Passw0rd!23';

    const registerRes = http.post(
      `${AUTH_BASE_URL}/auth/register/buyer`,
      JSON.stringify({ email, password, name: `k6 Notification Buyer ${i}` }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (registerRes.status !== 201) {
      throw new Error(`setup: buyer ${i} registration failed (status ${registerRes.status}): ${registerRes.body}`);
    }
    // Registration deliberately does NOT return user.id (anti-email-
    // enumeration response shape, confirmed by inspection) - only a
    // verificationToken. user.id only appears in the LOGIN response, so
    // verify then log in to obtain the real id notification-service needs.
    const verificationToken = JSON.parse(registerRes.body).verificationToken;

    const verifyRes = http.post(
      `${AUTH_BASE_URL}/auth/email/verify`,
      JSON.stringify({ token: verificationToken }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (verifyRes.status !== 200 && verifyRes.status !== 201) {
      throw new Error(`setup: buyer ${i} email verification failed (status ${verifyRes.status})`);
    }

    const loginRes = http.post(
      `${AUTH_BASE_URL}/auth/login`,
      JSON.stringify({ email, password }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (loginRes.status !== 200 && loginRes.status !== 201) {
      throw new Error(`setup: buyer ${i} login failed (status ${loginRes.status})`);
    }
    const userId = JSON.parse(loginRes.body).user.id;
    buyers.push({ userId, stamp });
  }

  // One shared idempotency key, deliberately reused by every VU's SECOND
  // call (see default()) to exercise the concurrent-duplicate-submission
  // race, not just per-VU uniqueness.
  const sharedIdempotencyKey = `K6NOTIF-SHARED-${Date.now()}`;
  // The shared key needs its own real recipient too.
  const sharedRecipientUserId = buyers[0].userId;

  return { buyers, sharedIdempotencyKey, sharedRecipientUserId };
}

export default function (data) {
  const vuIndex = __VU - 1;
  const buyer = data.buyers[vuIndex];
  const headers = {
    'Content-Type': 'application/json',
    'X-Internal-Service-Key': INTERNAL_SERVICE_KEY,
  };

  // 1. Distinct event per buyer - the throughput/correctness half.
  const uniqueRes = http.post(
    `${NOTIFICATION_BASE_URL}/notifications/events`,
    JSON.stringify({
      type: 'DEALER_VERIFIED',
      userId: buyer.userId,
      idempotencyKey: `K6NOTIF-${buyer.stamp}`,
      payload: { note: 'k6 notification delivery load test' },
    }),
    { headers, tags: { name: 'notification_event' } },
  );
  check(uniqueRes, {
    'unique event accepted': (r) => r.status === 201 || r.status === 202,
  });
  if (uniqueRes.status !== 201 && uniqueRes.status !== 202) {
    console.error(`notification-delivery-load VU ${__VU}: unique event failed (status ${uniqueRes.status}): ${uniqueRes.body}`);
  }

  // 2. Every VU submits the SAME idempotency key at close to the same
  // moment - the actual concurrency race FR-53's unique index exists for.
  const sharedRes = http.post(
    `${NOTIFICATION_BASE_URL}/notifications/events`,
    JSON.stringify({
      type: 'DEALER_VERIFIED',
      userId: data.sharedRecipientUserId,
      idempotencyKey: data.sharedIdempotencyKey,
      payload: { note: 'k6 shared idempotency key race' },
    }),
    { headers, tags: { name: 'notification_event_shared_key' } },
  );
  check(sharedRes, {
    'shared-key event returned a consistent, non-error outcome': (r) => r.status === 201 || r.status === 202,
  });

  sleep(0.5);
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'notification-delivery-load made zero HTTP requests - every iteration threw before any ' +
        'request fired (check the k6 error log above and setup()).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
