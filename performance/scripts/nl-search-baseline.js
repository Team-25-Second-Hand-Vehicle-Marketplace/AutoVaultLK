import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import { BASE_URL } from '../config.js';

/**
 * Single-user baseline for natural-language search (GET /search/nl).
 *
 * Deliberately NOT gated on NFR-09's 500ms bar: the SRS states this
 * explicitly (NFR-09) - "average response time to natural language search
 * queries should be below 2 seconds for warm start AWS Lambda invocations.
 * However, the response time to cold start AWS Lambda invocations... may
 * take more time than the threshold set." This baseline runs against
 * marketplace-service as a live Node process (no Lambda cold start at all
 * locally, and no cold start in the CI smoke context either), so its
 * numbers are not directly comparable to a deployed Lambda's - the
 * threshold below is the SRS's own 2s figure, not NFR-09's 500ms, kept
 * separate for exactly that reason.
 *
 * When GROQ_API_KEY is set (true in this repo's local .env), this baseline
 * measures the REAL Groq LLM round-trip, not the deterministic-parser
 * fallback (marketplace-service/src/modules/search/groq/groq-fallback.service.ts) -
 * so unlike every other script here, part of what this measures is an
 * external network dependency this project does not control. That is the
 * point: NL search's latency profile is genuinely different in kind from
 * every structured endpoint, which is exactly why the Test Plan names it as
 * a separate critical transaction (§3.3.4) rather than folding it into the
 * filtered-search baseline.
 */

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
    },
  },
  thresholds: {
    // SRS NFR-09's own stated NL-search target (warm start), not the 500ms
    // CRUD/browse bar - see the file comment above.
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

const QUERIES = [
  'red Toyota Aqua under 6 million',
  'cheap manual petrol car in Colombo',
  'Honda Civic 2018 or newer',
];

export default function () {
  const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];

  const res = http.get(`${BASE_URL}/search/nl?q=${encodeURIComponent(q)}`, {
    tags: { name: 'nl_search' },
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

  sleep(1);
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'nl-search-baseline made zero HTTP requests - every iteration threw before the request ' +
        'fired (check the k6 error log above).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
