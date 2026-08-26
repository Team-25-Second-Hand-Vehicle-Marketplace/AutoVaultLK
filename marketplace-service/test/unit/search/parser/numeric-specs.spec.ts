import { parseQuery } from '../../../../src/modules/search/parser/deterministic-parser';
import { FIXTURE_VOCABULARY } from '../../../../src/modules/search/parser/fixture-vocabulary';

const parse = (q: string) => parseQuery(q, FIXTURE_VOCABULARY);

/**
 * Numeric spec phrases (FR-19 structured filters over the JSONB specs
 * column). "petrol 7 seat" previously resolved only PETROL: the bare 7 fell
 * through extractNumeric — below the 100,000 price floor, outside the
 * 1980–2100 year window — so it silently became semantic text and buyers got
 * 5-seaters ranked by vector similarity instead of an actual seat filter.
 */
describe('numeric spec extraction', () => {
  it('extracts a seat count and keeps the sibling fuel filter', () => {
    const result = parse('petrol 7 seat');

    expect(result.filters.specs).toEqual([{ key: 'seats', value: '7' }]);
    expect(result.filters.fuelType).toEqual(['PETROL']);
    // Both tokens are claimed, so nothing leaks into the vector query.
    expect(result.unresolvedTokens).toEqual([]);
    expect(result.confidence).toBe(1);
  });

  it.each([
    ['7 seater van', 'seats', '7'],
    ['4 door hatchback', 'doors', '4'],
    ['6 airbags', 'airbags', '6'],
  ])('parses "%s" as %s=%s', (query, key, value) => {
    expect(parse(query).filters.specs).toContainEqual({ key, value });
  });

  it('parses the hyphenated compound the tokenizer never splits', () => {
    // "7-seater" survives tokenization as one token because hyphens are kept
    // for trims like "CR-V", so the number+noun path cannot see it.
    expect(parse('7-seater').filters.specs).toEqual([{ key: 'seats', value: '7' }]);
  });

  it('rejects counts outside the key range rather than filtering to nothing', () => {
    // seats is declared min 2 / max 60; 600 is a typo, and consuming it would
    // produce a filter that matches no row while hiding the bad input.
    const result = parse('600 seats');

    expect(result.filters.specs).toBeUndefined();
    expect(result.unresolvedTokens).toContain('600');
  });

  it('accepts the declared boundary', () => {
    expect(parse('60 seats').filters.specs).toEqual([{ key: 'seats', value: '60' }]);
  });

  it('leaves prices and mileage to the numeric stage', () => {
    // A unit suffix means the number quantifies something else entirely.
    const result = parse('under 8.5m 95k');

    expect(result.filters.specs).toBeUndefined();
    expect(result.filters.maxPrice).toBe(8_500_000);
    expect(result.filters.maxMileage).toBe(95_000);
  });

  it('does not claim a number with no spec noun after it', () => {
    const result = parse('2018 toyota');

    expect(result.filters.specs).toBeUndefined();
    expect(result.filters.minYear).toBe(2018);
  });
});
