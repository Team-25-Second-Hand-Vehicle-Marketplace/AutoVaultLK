import { parseQuery } from '../../../../src/modules/search/parser/deterministic-parser';
import { FIXTURE_VOCABULARY } from '../../../../src/modules/search/parser/fixture-vocabulary';
import type { ExtractedFilters } from '../../../../src/modules/search/parser/types';

/**
 * Relevance check for the deterministic query parser: a labelled set of
 * buyer queries, each with the filters a human would expect, scored per field.
 *
 *   recall    - of the filters a human expects, how many did the parser find
 *   precision - of the filters the parser produced, how many were expected
 *               (a wrong filter is worse than a miss: it silently hides
 *               matching listings)
 *
 * Expectations describe the CORRECT reading of the query, not whatever the
 * parser currently returns. A case that fails is a real gap; list it in
 * KNOWN_GAPS (with the reason) rather than editing the expectation.
 */
type Expected = Partial<
  Pick<
    ExtractedFilters,
    | 'make'
    | 'model'
    | 'vehicleType'
    | 'condition'
    | 'fuelType'
    | 'transmissionType'
    | 'minPrice'
    | 'maxPrice'
    | 'minYear'
    | 'maxYear'
    | 'minMileage'
    | 'maxMileage'
  >
> & { bodyType?: string };

type Case = { q: string; expect: Expected };

const GOLDEN: Case[] = [
  // --- misspelled makes and models ---
  { q: 'toyata aqua', expect: { make: ['Toyota'], model: ['Aqua'], vehicleType: ['CAR'] } },
  { q: 'toyoota aqua', expect: { make: ['Toyota'], model: ['Aqua'], vehicleType: ['CAR'] } },
  { q: 'corrola', expect: { make: ['Toyota'], model: ['Corolla'], vehicleType: ['CAR'] } },
  { q: 'hoda civic', expect: { make: ['Honda'], model: ['Civic'], vehicleType: ['CAR'] } },
  { q: 'vezal', expect: { make: ['Honda'], model: ['Vezel'], vehicleType: ['SUV'] } },
  { q: 'nisan xtrail', expect: { make: ['Nissan'], model: ['X-Trail'], vehicleType: ['SUV'] } },
  { q: 'benz c200', expect: { make: ['Mercedes-Benz'], model: ['C200'], vehicleType: ['CAR'] } },
  { q: 'suzeki wagon r', expect: { make: ['Suzuki'], model: ['Wagon R'], vehicleType: ['CAR'] } },
  { q: 'land cruiser', expect: { make: ['Toyota'], model: ['Land Cruiser'], vehicleType: ['SUV'] } },

  // --- closed enums, with typos ---
  { q: 'deisel van', expect: { fuelType: ['DIESEL'], vehicleType: ['VAN'] } },
  { q: 'petrol auto', expect: { fuelType: ['PETROL'], transmissionType: ['AUTOMATIC'] } },
  { q: 'manual hatchbak', expect: { transmissionType: ['MANUAL'], bodyType: 'HATCHBACK' } },
  { q: 'electric suv', expect: { fuelType: ['ELECTRIC'], vehicleType: ['SUV'] } },
  { q: 'hybrid sedn', expect: { fuelType: ['HYBRID'], bodyType: 'SEDAN' } },
  { q: 'brand new honda fit', expect: { condition: ['NEW'], make: ['Honda'], model: ['Fit'], vehicleType: ['CAR'] } },
  { q: 'used toyota', expect: { condition: ['USED'], make: ['Toyota'] } },

  // --- numeric expressions ---
  { q: 'under 500k', expect: { maxPrice: 500_000 } },
  { q: 'under 20 million', expect: { maxPrice: 20_000_000 } },
  { q: 'less than 5 mil', expect: { maxPrice: 5_000_000 } },
  { q: 'toyota from 2015', expect: { make: ['Toyota'], minYear: 2015 } },
  { q: 'between 2015 and 2018', expect: { minYear: 2015, maxYear: 2018 } },
  { q: 'honda 2019', expect: { make: ['Honda'], minYear: 2019, maxYear: 2019 } },
  { q: 'toyota aqua under 8 million', expect: { make: ['Toyota'], model: ['Aqua'], vehicleType: ['CAR'], maxPrice: 8_000_000 } },
  {
    q: 'Toyata Corrola used 2018 8.5m 95k deisel auto',
    expect: {
      make: ['Toyota'],
      model: ['Corolla'],
      vehicleType: ['CAR'],
      condition: ['USED'],
      minYear: 2018,
      maxYear: 2018,
      maxPrice: 8_500_000,
      maxMileage: 95_000,
      fuelType: ['DIESEL'],
      transmissionType: ['AUTOMATIC'],
    },
  },

  // --- descriptive wording: nothing to filter on, so no filters at all ---
  { q: 'sporty family car', expect: { vehicleType: ['CAR'] } },
  { q: 'luxury', expect: {} },
  { q: 'well maintained one owner', expect: {} },
  { q: 'good for long drives', expect: {} },

  // --- traps: a wrong filter here would silently return nothing ---
  { q: 'volkswagon', expect: {} },
  { q: 'sport', expect: {} },
  { q: 'family', expect: {} },
  { q: 'honda corolla', expect: { make: ['Honda'] } },
];

type Score = { expected: number; produced: number; correct: number };

const norm = (v: unknown) => JSON.stringify(v);

function flatten(f: ExtractedFilters): Record<string, unknown> {
  const { specs, ...rest } = f;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) out[k] = v;
  const body = specs?.find((s) => s.key === 'body_type');
  if (body) out.bodyType = body.value;
  return out;
}

function score(cases: Case[]) {
  const total: Score = { expected: 0, produced: 0, correct: 0 };
  const failures: string[] = [];
  let exact = 0;

  for (const { q, expect: want } of cases) {
    const got = flatten(parseQuery(q, FIXTURE_VOCABULARY).filters);
    const wantEntries = Object.entries(want);
    total.expected += wantEntries.length;
    total.produced += Object.keys(got).length;

    let caseOk = Object.keys(got).length === wantEntries.length;
    for (const [k, v] of wantEntries) {
      if (norm(got[k]) === norm(v)) total.correct += 1;
      else caseOk = false;
    }
    if (caseOk) exact += 1;
    else failures.push(`"${q}"\n     want ${norm(want)}\n     got  ${norm(got)}`);
  }

  return {
    recall: total.expected ? total.correct / total.expected : 1,
    precision: total.produced ? total.correct / total.produced : 1,
    exactQueries: exact,
    queries: cases.length,
    failures,
  };
}

/** Queries the parser is known to get wrong, with the reason. Keep short. */
const KNOWN_GAPS: string[] = [];

describe('deterministic parser - golden query accuracy', () => {
  const result = score(GOLDEN.filter((c) => !KNOWN_GAPS.includes(c.q)));

  it('reports accuracy', () => {
    // eslint-disable-next-line no-console
    console.log(
      [
        `queries         ${result.queries}`,
        `exact matches   ${result.exactQueries}/${result.queries}`,
        `filter recall   ${(result.recall * 100).toFixed(1)}%`,
        `filter precision ${(result.precision * 100).toFixed(1)}%`,
        ...(result.failures.length ? ['misses:', ...result.failures.map((f) => '  ' + f)] : []),
      ].join('\n'),
    );
    expect(result.queries).toBeGreaterThan(0);
  });

  it('never produces a wrong filter (precision)', () => {
    expect(result.precision).toBeGreaterThanOrEqual(0.95);
  });

  it('finds the filters a buyer meant (recall)', () => {
    expect(result.recall).toBeGreaterThanOrEqual(0.9);
  });
});
