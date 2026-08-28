import { parseQuery } from '../../../../src/modules/search/parser/deterministic-parser';
import { FIXTURE_VOCABULARY } from '../../../../src/modules/search/parser/fixture-vocabulary';
import { tokenize } from '../../../../src/modules/search/parser/tokenize';
import { trigramSimilarity } from '../../../../src/modules/search/parser/trigram';
import { CONFIDENCE_THRESHOLD } from '../../../../src/modules/search/parser/types';

const parse = (q: string) => parseQuery(q, FIXTURE_VOCABULARY);

describe('parseQuery', () => {
  describe('SRS Appendix B messy row', () => {
    it('normalizes Toyata/Corrola/8.5m/95k/deisel/auto without Groq', () => {

      const result = parse('Toyata Corrola used 2018 8.5m 95k deisel auto');

      expect(result.filters).toMatchObject({
        make: ['Toyota'],
        model: ['Corolla'],
        condition: ['USED'],
        minYear: 2018,
        maxYear: 2018,
        maxPrice: 8_500_000,
        maxMileage: 95_000,
        fuelType: ['DIESEL'],
        transmissionType: ['AUTOMATIC'],
      });
      expect(result.filters.vehicleType).toEqual(['CAR']);
      expect(result.confidence).toBe(1);
      expect(result.needsGroqFallback).toBe(false);
      expect(result.unresolvedTokens).toEqual([]);
    });
  });

  describe('stage 3 exact vs stage 4 fuzzy', () => {
    it('resolves seeded aliases as exact hits', () => {
      const result = parse('toyata aqua');
      expect(result.filters.make).toEqual(['Toyota']);
      expect(result.filters.model).toEqual(['Aqua']);
      expect(result.needsGroqFallback).toBe(false);
    });

    it('fuzzy-matches an unseen make typo via trigrams', () => {
      // "toyoota" is not in aliases — this is the pg_trgm stand-in.
      expect(trigramSimilarity('toyoota', 'toyota')).toBeGreaterThan(0.45);
      const result = parse('toyoota aqua');
      expect(result.filters.make).toEqual(['Toyota']);
      expect(result.filters.model).toEqual(['Aqua']);
    });

    it('rejects digit-adjacent tokens as fuzzy makes (SAD 6.7 type-gating)', () => {
      const result = parse('95k toyoota');
      expect(result.filters.make).toBeUndefined();
      expect(result.filters.maxMileage).toBe(95_000);
      expect(result.unresolvedTokens).toContain('toyoota');
    });

    it('still allows exact alias hits when the token is digit-adjacent', () => {
      // Stage 4 is gated; Stage 3 is not. "toyata" is a seeded alias.
      const result = parse('95k toyata');
      expect(result.filters.make).toEqual(['Toyota']);
      expect(result.filters.maxMileage).toBe(95_000);
    });
  });

  describe('make before model', () => {
    it('infers Honda from an unmatched Civic', () => {
      const result = parse('civic');
      expect(result.filters.make).toEqual(['Honda']);
      expect(result.filters.model).toEqual(['Civic']);
    });

    it('does not attach a Toyota model after Honda is resolved', () => {
      const result = parse('honda corolla');
      expect(result.filters.make).toEqual(['Honda']);
      expect(result.filters.model).toBeUndefined();
      expect(result.unresolvedTokens).toContain('corolla');
    });

    it('attaches Corolla once Toyota is resolved', () => {
      const result = parse('toyota corolla');
      expect(result.filters.make).toEqual(['Toyota']);
      expect(result.filters.model).toEqual(['Corolla']);
    });
  });

  describe('stage 1 multi-word phrases', () => {
    it('extracts three wheeler as a vehicle type', () => {
      const result = parse('three wheeler');
      expect(result.filters.vehicleType).toEqual(['THREE_WHEELER']);
      expect(result.confidence).toBe(1);
    });

    it('extracts Land Cruiser as a model phrase and infers Toyota', () => {
      const result = parse('land cruiser');
      expect(result.filters.model).toEqual(['Land Cruiser']);
      expect(result.filters.make).toEqual(['Toyota']);
      expect(result.filters.vehicleType).toEqual(['SUV']);
    });

    it('extracts Wagon R', () => {
      const result = parse('suzuki wagon r');
      expect(result.filters.make).toEqual(['Suzuki']);
      expect(result.filters.model).toEqual(['Wagon R']);
    });

    it('extracts Mercedes-Benz from mercedes benz', () => {
      const result = parse('mercedes benz');
      expect(result.filters.make).toEqual(['Mercedes-Benz']);
    });
  });

  describe('stage 2 numeric patterns', () => {
    it('reads under 20 million as a price ceiling', () => {
      const result = parse('automatic SUV under 20 million');
      expect(result.filters.maxPrice).toBe(20_000_000);
      expect(result.filters.transmissionType).toEqual(['AUTOMATIC']);
      expect(result.filters.vehicleType).toEqual(['SUV']);
    });

    it('reads from 2015 as a year floor', () => {
      const result = parse('toyota from 2015');
      expect(result.filters.minYear).toBe(2015);
      expect(result.filters.maxYear).toBeUndefined();
    });

    it('reads between 2015 and 2018 as a year range', () => {
      const result = parse('between 2015 and 2018');
      expect(result.filters.minYear).toBe(2015);
      expect(result.filters.maxYear).toBe(2018);
    });

    it('treats an operator plus k as price, not mileage', () => {
      const result = parse('under 500k');
      expect(result.filters.maxPrice).toBe(500_000);
      expect(result.filters.maxMileage).toBeUndefined();
    });

    it('reads "mil" as a million-scale price, not an unresolved token', () => {
      const result = parse('electric and less than 5 mil');
      expect(result.filters.maxPrice).toBe(5_000_000);
      expect(result.filters.fuelType).toEqual(['ELECTRIC']);
      expect(result.unresolvedTokens).not.toContain('mil');
    });
  });

  describe('closed enums vs body specs', () => {
    it('maps suv onto vehicleType, not specs.body_type', () => {
      const result = parse('suv');
      expect(result.filters.vehicleType).toEqual(['SUV']);
      expect(result.filters.specs).toBeUndefined();
    });

    it('maps sedan onto specs.body_type', () => {
      const result = parse('sedan');
      expect(result.filters.specs).toEqual([{ key: 'body_type', value: 'SEDAN' }]);
      expect(result.filters.vehicleType).toBeUndefined();
    });
  });

  describe('FR-21.1 confidence and semantic leftovers', () => {
    it('masks stopwords without deleting them or counting them', () => {
      const tokens = tokenize('looking for a toyota');
      expect(tokens.map((t) => t.norm)).toEqual(['looking', 'for', 'a', 'toyota']);
      expect(tokens.filter((t) => t.stopword).map((t) => t.norm)).toEqual([
        'looking',
        'for',
        'a',
      ]);

      const result = parse('looking for a toyota');
      expect(result.filters.make).toEqual(['Toyota']);
      expect(result.confidence).toBe(1);
      expect(result.semanticText).toBe('');
    });

    it('routes unconsumed descriptive tokens into semanticText', () => {
      const result = parse('red toyota aqua under 10 million');
      expect(result.filters.make).toEqual(['Toyota']);
      expect(result.filters.model).toEqual(['Aqua']);
      expect(result.filters.maxPrice).toBe(10_000_000);
      expect(result.semanticText).toBe('red');
      expect(result.unresolvedTokens).toEqual(['red']);
      expect(result.confidence).toBeGreaterThan(CONFIDENCE_THRESHOLD);
      expect(result.needsGroqFallback).toBe(false);
    });

    it('flags Groq fallback when coverage is below 0.6', () => {
      const result = parse('well maintained full option sunroof leather');
      expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
      expect(result.needsGroqFallback).toBe(true);
      expect(result.semanticText).toContain('well');
      expect(result.filters.make).toBeUndefined();
    });

    it('treats an empty query as fully covered, with no filters', () => {
      const result = parse('   ');
      expect(result.confidence).toBe(1);
      expect(result.needsGroqFallback).toBe(false);
      expect(result.filters).toEqual({});
      expect(result.unresolvedTokens).toEqual([]);
    });
  });
});
