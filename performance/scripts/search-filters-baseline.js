import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import { BASE_URL, THRESHOLDS_NFR09 } from '../config.js';

/**
 * Single-user baseline for structured/filtered search
 * (GET /marketplace/search/filters), the highest-frequency, most
 * latency-sensitive transaction per the Test Plan's load-profile
 * rationale (§3.3.5). Phase C1: establishes a best-case per-transaction
 * number BEFORE any concurrent load is applied (§3.3.4), so later
 * concurrent-load results (Phase C2) can be attributed to contention
 * rather than merely observed.
 *
 * 1 virtual user, no ramp — a real baseline is a single caller with
 * nothing else competing for the same connection pool, cache, or CPU.
 *
 * Query mix: an unfiltered browse (the emptiest, most common request),
 * a narrow filter combination that exercises multiple WHERE clauses and
 * the verifiedDealersOnly join (see marketplace-service's
 * dealer-join.integration-spec.ts for why that join is expensive to get
 * wrong), and a sorted, paginated page 2 request — three distinct query
 * plans, not the same request repeated.
 */

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
    },
  },
  thresholds: THRESHOLDS_NFR09,
};

const QUERIES = [
  { limit: 20 },
  {
    make: 'Toyota',
    minPrice: 1000000,
    maxPrice: 8000000,
    verifiedDealersOnly: true,
    limit: 20,
  },
  { sort: 'price_asc', page: 2, limit: 20 },
];

/** k6's JS runtime (goja) has no URLSearchParams — build the query string by hand. */
function toQueryString(query) {
  return Object.entries(query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

export default function () {
  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];

  const res = http.get(`${BASE_URL}/search/filters?${toQueryString(query)}`, {
    tags: { name: 'search_filters' },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response has items array': (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).items);
      } catch {
        return false;
      }
    },
  });

  // A real single user pauses between actions; without this the "baseline"
  // becomes a tight-loop stress test against one VU instead of a
  // best-case per-transaction number.
  sleep(1);
}

/**
 * A script whose every iteration throws (e.g. a goja API k6 doesn't
 * support — URLSearchParams did exactly this here during development)
 * produces zero real HTTP requests, so http_req_failed's 0/0 rate reads as
 * a pass. handleSummary fails the run explicitly on that condition rather
 * than trusting the default text summary, which reports the same
 * misleadingly-green result.
 */
export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'search-filters-baseline made zero HTTP requests — every iteration threw before the ' +
        'request fired (check the k6 error log above), which the default summary reports as a ' +
        'false-positive pass.',
    );
  }
  // Reproduces k6's own default text summary — handleSummary(), once
  // defined, REPLACES the default stdout output rather than supplementing
  // it, so this has to be provided explicitly or the run prints nothing.
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
