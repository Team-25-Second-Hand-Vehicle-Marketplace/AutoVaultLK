import { VehicleSearchRepository } from '../../../../src/modules/search/repositories/vehicle-search.repository';
import { buildFilterQuery } from '../../../../src/modules/search/filters/filter-query.builder';
import { FilterSearchDto } from '../../../../src/modules/search/dto/filter-search.dto';
import { EMBEDDING_DIMENSIONS } from '../../../../src/shared/normalize-embed';

/**
 * The repository is the layer that turns a built WHERE clause into a real
 * statement: it owns JOIN composition, ORDER BY resolution, LIMIT/OFFSET
 * parameter numbering, and row mapping.
 *
 * None of that is covered by the query-builder tests, and all of it is the
 * kind of code where an off-by-one in parameter indexing produces a runtime
 * error only under a specific combination of options (relevance sort + a
 * keyword + verifiedDealersOnly, for instance).
 *
 * DataSource is stubbed rather than connected: these assert the SQL and
 * parameters the repository *composes*, which is exactly the part that can
 * be wrong without Postgres ever being reached.
 */

interface Captured {
  sql: string;
  params: unknown[];
}

/**
 * A DataSource stub that records every query and returns a caller-supplied
 * result per call, in order.
 */
function makeDataSource(results: unknown[][] = []) {
  const calls: Captured[] = [];
  let callIndex = 0;

  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const result = results[callIndex] ?? [];
      callIndex += 1;
      return result;
    }),
  };

  return { dataSource, calls };
}

function makeRepository(results: unknown[][] = []) {
  const { dataSource, calls } = makeDataSource(results);
  const repository = new VehicleSearchRepository(dataSource as never);
  return { repository, calls, dataSource };
}

/** Collapses whitespace so assertions are not defeated by SQL formatting. */
const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

/** A representative raw row, matching the columns SELECT_COLUMNS projects. */
const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  vehicle_type: 'CAR',
  make: 'Toyota',
  model: 'Aqua',
  manufacture_year: 2015,
  registration_year: 2016,
  effective_year: 2016,
  price: '4750000.00',
  is_negotiable: true,
  mileage: 62000,
  fuel_type: 'HYBRID',
  transmission_type: 'AUTOMATIC',
  location_city: 'Colombo',
  location_district: 'Colombo',
  condition: 'USED',
  specs: { seats: 5, body_type: 'HATCHBACK' },
  created_at: new Date('2026-01-15T00:00:00Z'),
  dealer_verified: true,
  image_path: 'vehicles/a/main.jpg',
  thumbnail_path: 'vehicles/a/thumb.jpg',
};

describe('VehicleSearchRepository — search()', () => {
  it('always filters on LIVE status, inherited from the builder', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = {};

    await repository.search(buildFilterQuery(dto), dto);

    expect(flat(calls[0].sql)).toContain('WHERE v.status = $1');
    expect(calls[0].params[0]).toBe('LIVE');
  });

  it('LEFT JOINs images and dealer profiles so rows are never dropped', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = {};

    await repository.search(buildFilterQuery(dto), dto);
    const sql = flat(calls[0].sql);

    // An INNER JOIN on either would silently return zero results while
    // vehicle_images is empty, or hide dealers with no profile row.
    expect(sql).toContain('LEFT JOIN marketplace.vehicle_images');
    expect(sql).toContain('LEFT JOIN auth.dealer_profiles dpv');
  });

  it('appends LIMIT and OFFSET as the last two parameters', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = { page: 3, limit: 20 };

    await repository.search(buildFilterQuery(dto), dto);
    const { params, sql } = calls[0];

    expect(params[params.length - 2]).toBe(20);
    expect(params[params.length - 1]).toBe(40); // (3 - 1) * 20
    expect(flat(sql)).toContain(`LIMIT $${params.length - 1} OFFSET $${params.length}`);
  });

  it('defaults to page 1 and a 20-row page', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = {};

    await repository.search(buildFilterQuery(dto), dto);
    const { params } = calls[0];

    expect(params[params.length - 2]).toBe(20);
    expect(params[params.length - 1]).toBe(0);
  });

  it('keeps parameter numbering consistent when filters precede pagination', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = { make: ['Toyota'], maxPrice: 5_000_000 };

    await repository.search(buildFilterQuery(dto), dto);
    const { params, sql } = calls[0];

    // status, make, maxPrice, limit, offset
    expect(params).toHaveLength(5);
    expect(params[1]).toEqual(['Toyota']);
    expect(params[2]).toBe(5_000_000);
    expect(flat(sql)).toContain('LIMIT $4 OFFSET $5');
  });
});

describe('VehicleSearchRepository — vector ranking (FR-23)', () => {
  /**
   * These assert the seam between the rank decision and the emitted SQL.
   *
   * buildOrderBy is unit-tested directly, but nothing else proves the
   * repository actually forwards rank.queryEmbedding into the statement.
   * That gap is not academic: every listing embedding was NULL and
   * @xenova/transformers was absent for the whole life of this branch, so
   * embedQuery() always returned null and semantic ranking silently never
   * ran — while the suite stayed green, because no test reached this path.
   */
  const unitVector = () => {
    const values = new Array(EMBEDDING_DIMENSIONS).fill(0);
    values[0] = 1;
    return values;
  };

  it('orders by cosine distance when a query embedding is supplied', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = { sort: 'relevance' };

    await repository.search(buildFilterQuery(dto), dto, {
      queryEmbedding: unitVector(),
    });
    const { sql, params } = calls[0];

    expect(flat(sql)).toContain('ORDER BY v.embedding <=> $');
    expect(flat(sql)).toContain('::vector ASC NULLS LAST');
    // NULLS LAST matters while ingestion is not built: an un-embedded row
    // must sink to the bottom, not sort ahead of every real match.
    expect(params.some((p) => typeof p === 'string' && p.startsWith('[1,0,'))).toBe(true);
  });

  it('binds the vector as a parameter rather than inlining 384 floats', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = { sort: 'relevance' };

    await repository.search(buildFilterQuery(dto), dto, {
      queryEmbedding: unitVector(),
    });

    // Inlining would both blow past sane SQL sizes and defeat plan caching.
    expect(flat(calls[0].sql)).not.toContain('[1,0,');
  });

  it('numbers the vector parameter before limit and offset', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = { sort: 'relevance', page: 2, limit: 10 };

    await repository.search(buildFilterQuery(dto), dto, {
      queryEmbedding: unitVector(),
    });
    const { params, sql } = calls[0];

    expect(params[params.length - 2]).toBe(10);
    expect(params[params.length - 1]).toBe(10);
    expect(flat(sql)).toContain(`v.embedding <=> $${params.length - 2}::vector`);
  });

  it('prefers the vector over trigram when MiniLM produced one (FR-24)', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = { sort: 'relevance' };

    await repository.search(buildFilterQuery(dto), dto, {
      queryEmbedding: unitVector(),
      trigramQuery: 'leather',
    });

    expect(flat(calls[0].sql)).toContain('v.embedding <=>');
    expect(flat(calls[0].sql)).not.toContain('word_similarity');
  });

  it('leaves the vector out of COUNT, which must not be ordered', async () => {
    const { repository, calls } = makeRepository([[{ count: '7' }]]);
    const dto: FilterSearchDto = {};

    await repository.count(buildFilterQuery(dto), false, {
      queryEmbedding: unitVector(),
    });

    // Ranking cannot change a total, so paying for a vector scan here would
    // be pure cost — and ORDER BY in a COUNT is meaningless anyway.
    expect(flat(calls[0].sql)).not.toContain('<=>');
    expect(flat(calls[0].sql)).not.toContain('ORDER BY');
  });
});

describe('VehicleSearchRepository — sort resolution', () => {
  it('ranks by ts_rank when sorting by relevance with a keyword', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = { q: 'hybrid', sort: 'relevance' };

    await repository.search(buildFilterQuery(dto), dto);
    const { sql, params } = calls[0];

    expect(flat(sql)).toContain('ORDER BY ts_rank(v.search_vector');
    // The keyword is a bound parameter, never inlined into the SQL text.
    expect(params).toContain('hybrid');
    expect(flat(sql)).not.toContain('hybrid');
  });

  it('falls back to recency for relevance with no keyword', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = { sort: 'relevance' };

    await repository.search(buildFilterQuery(dto), dto);

    // There is nothing to rank against, so a blended score is meaningless.
    expect(flat(calls[0].sql)).toContain('ORDER BY v.created_at DESC');
    expect(flat(calls[0].sql)).not.toContain('ts_rank');
  });

  it('treats a whitespace-only keyword as absent', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = { q: '   ', sort: 'relevance' };

    await repository.search(buildFilterQuery(dto), dto);

    expect(flat(calls[0].sql)).not.toContain('ts_rank');
  });

  it('numbers the ts_rank parameter before limit and offset', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = { q: 'hybrid', sort: 'relevance', page: 2, limit: 10 };

    await repository.search(buildFilterQuery(dto), dto);
    const { params, sql } = calls[0];

    // status, q (WHERE), q (ts_rank), limit, offset — the rank parameter is
    // appended before pagination, and the indexes in the SQL must match.
    expect(params[params.length - 3]).toBe('hybrid');
    expect(params[params.length - 2]).toBe(10);
    expect(params[params.length - 1]).toBe(10);
    expect(flat(sql)).toContain(`ts_rank(v.search_vector, plainto_tsquery('english', $${params.length - 2}))`);
  });

  it.each([
    ['price_asc', 'v.price ASC'],
    ['price_desc', 'v.price DESC'],
    ['mileage_asc', 'v.mileage ASC'],
    ['newest', 'v.created_at DESC'],
    ['year_desc', 'COALESCE(v.registration_year, v.manufacture_year) DESC'],
  ] as const)('maps sort=%s to a constant ORDER BY', async (sort, expected) => {
    const { repository, calls } = makeRepository([[ROW]]);
    const dto: FilterSearchDto = { sort };

    await repository.search(buildFilterQuery(dto), dto);

    expect(flat(calls[0].sql)).toContain(`ORDER BY ${expected}`);
  });

  it('never interpolates a user-supplied sort value into SQL', async () => {
    const { repository, calls } = makeRepository([[ROW]]);
    // A value that would be rejected by @IsIn upstream; asserting the
    // repository does not concatenate it even if it somehow arrived.
    const dto = { sort: 'price_asc; DROP TABLE vehicles--' } as unknown as FilterSearchDto;

    await repository.search(buildFilterQuery(dto), dto);

    expect(calls[0].sql).not.toContain('DROP TABLE');
  });
});

describe('VehicleSearchRepository — verifiedDealersOnly', () => {
  it('adds an INNER JOIN and a bound VERIFIED parameter', async () => {
    const { repository, calls } = makeRepository([[{ count: '3' }]]);
    const dto: FilterSearchDto = { verifiedDealersOnly: true };

    await repository.count(buildFilterQuery(dto), true);
    const { sql, params } = calls[0];

    expect(flat(sql)).toContain('JOIN auth.dealer_profiles dp ON dp.user_id = v.dealer_id');
    expect(flat(sql)).toContain('dp.verification_status = $2');
    expect(params[1]).toBe('VERIFIED');
  });

  it('does not add the join when the flag is absent', async () => {
    const { repository, calls } = makeRepository([[{ count: '9' }]]);
    const dto: FilterSearchDto = {};

    await repository.count(buildFilterQuery(dto), undefined);

    expect(flat(calls[0].sql)).not.toContain('JOIN auth.dealer_profiles dp');
  });

  it('numbers the VERIFIED parameter after every filter parameter', async () => {
    const { repository, calls } = makeRepository([[{ count: '1' }]]);
    const dto: FilterSearchDto = { make: ['Toyota'], maxPrice: 5_000_000 };

    await repository.count(buildFilterQuery(dto), true);
    const { sql, params } = calls[0];

    // status, make, maxPrice, then VERIFIED.
    expect(params).toHaveLength(4);
    expect(params[3]).toBe('VERIFIED');
    expect(flat(sql)).toContain('dp.verification_status = $4');
  });

  it('does not mutate the built query params array', async () => {
    const { repository } = makeRepository([[{ count: '1' }]]);
    const dto: FilterSearchDto = { make: ['Toyota'] };
    const built = buildFilterQuery(dto);
    const before = built.params.length;

    await repository.count(built, true);

    // The same built object is reused across count/search/relaxation; a
    // push() here would corrupt every subsequent use.
    expect(built.params).toHaveLength(before);
  });
});

describe('VehicleSearchRepository — count()', () => {
  it('parses the string count Postgres returns into a number', async () => {
    const { repository } = makeRepository([[{ count: '42' }]]);

    const total = await repository.count(buildFilterQuery({}), false);

    expect(total).toBe(42);
    expect(typeof total).toBe('number');
  });

  it('omits the display-only joins that cannot change the count', async () => {
    const { repository, calls } = makeRepository([[{ count: '7' }]]);

    await repository.count(buildFilterQuery({}), false);
    const sql = flat(calls[0].sql);

    expect(sql).not.toContain('vehicle_images');
    expect(sql).toContain('COUNT(*)');
  });
});

describe('VehicleSearchRepository — facets()', () => {
  it('runs one query per dimension', async () => {
    const { repository, dataSource } = makeRepository([[], [], [], [], []]);

    await repository.facets({});

    expect(dataSource.query).toHaveBeenCalledTimes(5);
  });

  it('excludes a dimension from its own count query', async () => {
    const { repository, calls } = makeRepository([[], [], [], [], []]);

    await repository.facets({ fuelType: ['PETROL'], make: ['Toyota'] });

    const fuelQuery = calls.find((c) => c.sql.includes('v.fuel_type AS value'));
    expect(fuelQuery).toBeDefined();
    // The fuel facet must NOT be constrained by the fuel filter, or it
    // collapses to "PETROL (n)" and answers nothing.
    expect(fuelQuery!.params).not.toContainEqual(['PETROL']);
    // Other dimensions' filters still apply.
    expect(fuelQuery!.params).toContainEqual(['Toyota']);
  });

  it('keeps a dimension constrained by the other dimensions', async () => {
    const { repository, calls } = makeRepository([[], [], [], [], []]);

    await repository.facets({ fuelType: ['PETROL'] });

    const makeQuery = calls.find((c) => c.sql.includes('v.make AS value'));
    expect(makeQuery!.params).toContainEqual(['PETROL']);
  });

  it('excludes NULL values from every facet', async () => {
    const { repository, calls } = makeRepository([[], [], [], [], []]);

    await repository.facets({});

    for (const call of calls) {
      expect(flat(call.sql)).toContain('IS NOT NULL');
    }
  });

  it('maps rows into value/count buckets with numeric counts', async () => {
    const { repository } = makeRepository([
      [{ value: 'CAR', count: '14' }, { value: 'SUV', count: '3' }],
      [],
      [],
      [],
      [],
    ]);

    const facets = await repository.facets({});

    expect(facets.vehicleType).toEqual([
      { value: 'CAR', count: 14 },
      { value: 'SUV', count: 3 },
    ]);
  });

  it('returns a bucket list for every dimension', async () => {
    const { repository } = makeRepository([[], [], [], [], []]);

    const facets = await repository.facets({});

    expect(Object.keys(facets).sort()).toEqual([
      'condition',
      'fuelType',
      'make',
      'transmissionType',
      'vehicleType',
    ]);
  });
});

describe('VehicleSearchRepository — findById()', () => {
  const DETAIL_ROW = {
    ...ROW,
    description: 'Well maintained',
    color: 'Pearl White',
    owners_count: 1,
    engine_capacity_cc: 1500,
    dealer_id: '22222222-2222-4222-8222-222222222222',
    dealer_company_name: 'Colombo Motors',
    dealer_city: 'Colombo',
    dealer_contact_number: '0771234567',
    image_paths: ['vehicles/a/main.jpg', 'vehicles/a/2.jpg'],
  };

  it('gates on LIVE status so a DRAFT listing is indistinguishable from missing', async () => {
    const { repository, calls } = makeRepository([[]]);

    await repository.findById('11111111-1111-4111-8111-111111111111');

    expect(flat(calls[0].sql)).toContain('WHERE v.id = $1 AND v.status = $2');
    expect(calls[0].params[1]).toBe('LIVE');
  });

  it('returns null rather than throwing when nothing matches', async () => {
    const { repository } = makeRepository([[]]);

    // The controller owns the HTTP shape; the repository stays transport
    // agnostic.
    await expect(
      repository.findById('11111111-1111-4111-8111-111111111111'),
    ).resolves.toBeNull();
  });

  it('maps the dealer block', async () => {
    const { repository } = makeRepository([[DETAIL_ROW]]);

    const detail = await repository.findById(DETAIL_ROW.id);

    expect(detail!.dealer).toEqual({
      id: DETAIL_ROW.dealer_id,
      companyName: 'Colombo Motors',
      city: 'Colombo',
      contactNumber: '0771234567',
      verified: true,
    });
  });

  it('defaults images to an empty array when the aggregate is NULL', async () => {
    const { repository } = makeRepository([[{ ...DETAIL_ROW, image_paths: null }]]);

    const detail = await repository.findById(DETAIL_ROW.id);

    expect(detail!.images).toEqual([]);
  });
});

describe('VehicleSearchRepository — row mapping', () => {
  it('converts the numeric price string into a number', async () => {
    const { repository } = makeRepository([[ROW]]);

    const [item] = await repository.search(buildFilterQuery({}), {});

    // pg returns NUMERIC as a string; leaving it would make the frontend
    // render "4750000.00" and break every arithmetic comparison.
    expect(item.price).toBe(4_750_000);
    expect(typeof item.price).toBe('number');
  });

  it('exposes the COALESCEd effective year alongside both raw years', async () => {
    const { repository } = makeRepository([
      [{ ...ROW, registration_year: null, manufacture_year: 2014, effective_year: 2014 }],
    ]);

    const [item] = await repository.search(buildFilterQuery({}), {});

    expect(item.registrationYear).toBeNull();
    expect(item.manufactureYear).toBe(2014);
    expect(item.effectiveYear).toBe(2014);
  });

  it('treats a NULL dealer_verified as not verified', async () => {
    const { repository } = makeRepository([[{ ...ROW, dealer_verified: null }]]);

    const [item] = await repository.search(buildFilterQuery({}), {});

    // A vehicle whose dealer has no profile row is "not verified" for badge
    // purposes, not "unknown" — the badge must never render on null.
    expect(item.dealerVerified).toBe(false);
  });

  it('reports real per-row verification rather than echoing the filter', async () => {
    const { repository } = makeRepository([
      [
        { ...ROW, id: 'a', dealer_verified: true },
        { ...ROW, id: 'b', dealer_verified: false },
      ],
    ]);

    const items = await repository.search(buildFilterQuery({}), {});

    expect(items.map((i) => i.dealerVerified)).toEqual([true, false]);
  });

  it('passes image paths through as nullable urls', async () => {
    const { repository } = makeRepository([
      [{ ...ROW, image_path: null, thumbnail_path: null }],
    ]);

    const [item] = await repository.search(buildFilterQuery({}), {});

    expect(item.imageUrl).toBeNull();
    expect(item.thumbnailUrl).toBeNull();
  });
});
