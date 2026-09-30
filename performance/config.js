/**
 * Shared config for k6 scripts: target base URL and the NFR-derived
 * thresholds every script gates against.
 *
 * BASE_URL defaults to marketplace-service direct (no gateway prefix — k6
 * is not a browser, so it talks to the service port directly, the same way
 * the integration suites' database connections bypass the app layer where
 * the interesting behaviour lives). Override with -e BASE_URL=... to point
 * at staging once Phase C2 (concurrent load) runs there.
 *
 * NFR-09 (SRS): average API response time under 500ms for all CRUD/browse
 * APIs. k6 thresholds gate on p(95) rather than the literal "average" the
 * SRS states, because a raw average hides a long tail that an average
 * buyer session would still experience — the stricter, more useful bar.
 */
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3002';

export const THRESHOLDS_NFR09 = {
  http_req_duration: ['p(95)<500'],
  http_req_failed: ['rate<0.01'],
};
