import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import { BASE_URL, THRESHOLDS_NFR09 } from '../config.js';

/**
 * Single-user baseline for listing detail (GET /search/vehicles/:id) -
 * one of the Test Plan's named critical transactions. Unlike filtered
 * search, this is a single-row lookup by primary key, so its baseline
 * exists mainly to catch regressions in the join fan-out (dealer profile,
 * images, normalization provenance) that VehicleDetailDto assembles, not
 * to prove an index is used - a PK lookup barely needs one.
 *
 * setup() resolves one real vehicle id once, rather than every iteration
 * re-discovering it via a second HTTP call that would itself get measured
 * and pollute this endpoint's own numbers.
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

export function setup() {
  const res = http.get(`${BASE_URL}/search/filters?limit=1`);
  if (res.status !== 200) {
    throw new Error(`setup: could not fetch a vehicle id (status ${res.status})`);
  }
  const items = JSON.parse(res.body).items;
  if (!items || items.length === 0) {
    throw new Error('setup: local catalogue is empty - is it seeded (database/ seed:vehicles)?');
  }
  return { vehicleId: items[0].id };
}

export default function (data) {
  const res = http.get(`${BASE_URL}/search/vehicles/${data.vehicleId}`, {
    tags: { name: 'vehicle_detail' },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response has an id matching the request': (r) => {
      try {
        return JSON.parse(r.body).id === data.vehicleId;
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
      'listing-detail-baseline made zero HTTP requests - every iteration threw before the ' +
        'request fired (check the k6 error log above and setup()).',
    );
  }
  return { stdout: textSummary(data, { indent: ' ', enableColors: true }) };
}
