import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import { BASE_URL } from '../config.js';

/**
 * NL search under real concurrency — only ~20% of buyers used NL search in
 * end-to-end-load.js's combined scenario (10 VUs out of 50 at any moment);
 * this pushes NL search itself to real concurrency, unmixed with other
 * traffic, so any degradation is attributable to NL search specifically.
 *
 * Deliberately MODEST concurrency (15 VUs, not NFR-10's 50): every request
 * here is a REAL call to Groq's hosted LLM API
 * (marketplace-service/src/modules/search/groq/groq-client.ts), which has
 * its own account-level rate limit this project does not control and this
 * script has no visibility into (no client-side rate limiting exists in
 * groq-fallback.service.ts — confirmed by inspection before this script
 * was written). Going past what the account's real tier allows would
 * produce Groq 429s that look like an AutoVaultLK failure but are actually
 * "too many real requests sent to a third party in too short a window" —
 * a different, less interesting signal than what this script exists to
 * measure. If REQUESTS PER SECOND needs to go higher than this default,
 * raise it deliberately with the account's actual Groq tier limits in hand,
 * not by guessing upward from here.
 *
 * What this DOES meaningfully test: AutoVaultLK's own handling of
 * concurrent LLM calls — connection reuse, GROQ_TIMEOUT_MS behaviour under
 * load, and whether the deterministic-parser fallback (NFR-12.1) engages
 * correctly if any individual call times out or errors, rather than the
 * whole request failing.
 */

const NUM_VUS = Number(__ENV.NUM_VUS || 15);

export const options = {
  scenarios: {
    nl_search_concurrency: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 5 },
        { duration: '20s', target: 5 },
        { duration: '15s', target: NUM_VUS },
        { duration: '30s', target: NUM_VUS },
        { duration: '15s', target: 0 },
      ],
    },
  },
  thresholds: {
    // SRS's own warm-start NL-search figure (NFR-09), not the 500ms
    // CRUD/browse bar — same reasoning as nl-search-baseline.js.
    http_req_duration: ['p(95)<2000'],
    // Looser than the usual 1%: a real external API occasionally
    // rate-limiting or timing out under concurrent load is a real,
    // expected possibility this script is specifically checking AutoVaultLK
    // degrades from gracefully (NFR-12.1's fallback), not a failure of
    // AutoVaultLK's own code the way a 0%-tolerance threshold would imply.
    http_req_failed: ['rate<0.05'],
  },
};

const NL_QUERIES = [
  'red Toyota Aqua under 6 million',
  'cheap manual petrol car in Colombo',
  'Honda Civic 2018 or newer',
  'white SUV with low mileage',
  'diesel double cab pickup under 8 million',
];

export default function () {
  const q = NL_QUERIES[Math.floor(Math.random() * NL_QUERIES.length)];

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

  // A real user pauses between searches; real pacing also keeps this
  // script's total request rate against Groq predictable rather than
  // tight-looping.
  sleep(2);
}

export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  if (totalRequests === 0) {
    throw new Error(
      'nl-search-concurrency made zero HTTP requests — every iteration threw before the request ' +
        'fired (check the k6 error log above).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
