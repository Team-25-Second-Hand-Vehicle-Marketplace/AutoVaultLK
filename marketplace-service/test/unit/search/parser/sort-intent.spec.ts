import { parseQuery } from '../../../../src/modules/search/parser/deterministic-parser';
import { FIXTURE_VOCABULARY } from '../../../../src/modules/search/parser/fixture-vocabulary';

const parse = (q: string) => parseQuery(q, FIXTURE_VOCABULARY);

describe('sort intent', () => {
  describe('the query that regressed: "cheap" reached semantic ranking', () => {
    it('resolves "i want a cheap car" to price_asc with nothing left over', () => {
      const result = parse('i want a cheap car');

      expect(result.filters.sort).toBe('price_asc');
      expect(result.filters.vehicleType).toEqual(['CAR']);
      // The whole point: "cheap" is consumed, so confidence is honest, Groq
      // is not called, and the word never reaches semanticText.
      expect(result.unresolvedTokens).toEqual([]);
      expect(result.semanticText).toBe('');
      expect(result.confidence).toBe(1);
      expect(result.needsGroqFallback).toBe(false);
    });

    it('resolves a bare "cheap" without inventing a filter', () => {
      const result = parse('cheap');

      expect(result.filters.sort).toBe('price_asc');
      expect(result.filters.maxPrice).toBeUndefined();
      expect(result.unresolvedTokens).toEqual([]);
      expect(result.needsGroqFallback).toBe(false);
    });
  });

  describe('vocabulary', () => {
    it.each([
      ['cheapest suv', 'price_asc'],
      ['affordable toyota', 'price_asc'],
      ['budget van', 'price_asc'],
      ['inexpensive car', 'price_asc'],
      ['expensive suv', 'price_desc'],
      ['newest corolla', 'year_desc'],
      ['latest prius', 'year_desc'],
    ])('maps %j to %s', (query, sort) => {
      expect(parse(query).filters.sort).toBe(sort);
    });

    it.each([
      ['lowest price car', 'price_asc'],
      ['least expensive van', 'price_asc'],
      ['highest price suv', 'price_desc'],
      ['most expensive car', 'price_desc'],
      ['low mileage corolla', 'mileage_asc'],
      ['lowest mileage van', 'mileage_asc'],
    ])('maps the phrase %j to %s', (query, sort) => {
      expect(parse(query).filters.sort).toBe(sort);
    });

    it('prefers the phrase over the single word it starts with', () => {
      // "lowest" alone is price_asc; "lowest mileage" must not stop there.
      expect(parse('lowest mileage car').filters.sort).toBe('mileage_asc');
    });

    it('leaves a query with no ordering word alone', () => {
      expect(parse('toyota corolla 2018').filters.sort).toBeUndefined();
    });
  });

  describe('an explicit number always wins the token', () => {
    it('keeps maxPrice and still sorts for "cheap cars under 3 million"', () => {
      const result = parse('cheap cars under 3 million');

      expect(result.filters.maxPrice).toBe(3_000_000);
      expect(result.filters.sort).toBe('price_asc');
    });

    it('reads "cheaper than 5 million" as a bound, not only an ordering', () => {
      const result = parse('cheaper than 5 million');

      expect(result.filters.maxPrice).toBe(5_000_000);
    });
  });

  describe('words that must not be read as an ordering', () => {
    it('keeps "new" as a condition', () => {
      const result = parse('new car');

      expect(result.filters.condition).toEqual(['NEW']);
      expect(result.filters.sort).toBeUndefined();
    });

    it('leaves "economical" to semantic ranking - it is fuel use, not price', () => {
      const result = parse('economical car');

      expect(result.filters.sort).toBeUndefined();
      expect(result.unresolvedTokens).toContain('economical');
    });
  });

  describe('one ORDER BY, so the first intent wins', () => {
    it('takes the first and leaves the second unresolved rather than silently dropping it', () => {
      const result = parse('cheap newest car');

      expect(result.filters.sort).toBe('price_asc');
      expect(result.unresolvedTokens).toContain('newest');
    });
  });
});
