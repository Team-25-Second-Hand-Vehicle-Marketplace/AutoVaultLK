import { tokenize } from '../../../../src/modules/search/parser/tokenize';
import { extractNumeric, parseMagnitude } from '../../../../src/modules/search/parser/numeric';
import type { ExtractedFilters } from '../../../../src/modules/search/parser/types';

function extract(query: string): ExtractedFilters {
  const filters: ExtractedFilters = {};
  extractNumeric(tokenize(query), filters);
  return filters;
}

describe('parseMagnitude', () => {
  it('parses a bare integer with no unit', () => {
    expect(parseMagnitude('500')).toEqual({ n: 500, unit: undefined });
  });

  it('parses a decimal with an "m" (million) unit', () => {
    expect(parseMagnitude('8.5m')).toEqual({ n: 8.5, unit: 'm' });
  });

  it('parses a "k" unit', () => {
    expect(parseMagnitude('95k')).toEqual({ n: 95, unit: 'k' });
  });

  it('returns undefined for a non-numeric string', () => {
    expect(parseMagnitude('toyota')).toBeUndefined();
  });
});

describe('extractNumeric', () => {
  it('reads a 4-digit value in the valid year range as an exact year', () => {
    expect(extract('2018 toyota')).toEqual({ minYear: 2018, maxYear: 2018 });
  });

  it('treats "under 500k" as a price ceiling, not a mileage ceiling', () => {
    expect(extract('under 500k')).toEqual({ maxPrice: 500_000 });
  });

  it('treats a bare "95k" (no operator) as a mileage ceiling', () => {
    expect(extract('95k')).toEqual({ maxMileage: 95_000 });
  });

  it('scales "8.5m" to a price in the millions', () => {
    expect(extract('8.5m budget')).toEqual({ maxPrice: 8_500_000 });
  });

  it('treats "over 2015" as a minimum year', () => {
    expect(extract('over 2015')).toEqual({ minYear: 2015 });
  });

  it('treats "before 2015" as a maximum year', () => {
    expect(extract('before 2015')).toEqual({ maxYear: 2015 });
  });

  it('handles "between X and Y" as a min/max price range', () => {
    expect(extract('between 3m and 5m')).toEqual({ minPrice: 3_000_000, maxPrice: 5_000_000 });
  });

  it('orders a between-range correctly even if given high-to-low', () => {
    expect(extract('between 5m and 3m')).toEqual({ minPrice: 3_000_000, maxPrice: 5_000_000 });
  });

  it('combines a repeated max-price mention by keeping the larger of the two ceilings', () => {
    // applyBound's maxNum takes the larger value on repeated max mentions —
    // this pins that (perhaps surprising) actual behavior rather than assuming
    // it narrows to the tighter constraint.
    const filters: ExtractedFilters = {};
    extractNumeric(tokenize('under 5m'), filters);
    extractNumeric(tokenize('under 3m'), filters);
    expect(filters.maxPrice).toBe(5_000_000);
  });

  it('treats an explicit "km" unit as mileage, scaled by 1000', () => {
    expect(extract('over 50km')).toEqual({ minMileage: 50_000 });
  });

  it('ignores an already-consumed token', () => {
    const tokens = tokenize('2018');
    tokens[0].consumed = true;
    const filters: ExtractedFilters = {};
    extractNumeric(tokens, filters);
    expect(filters).toEqual({});
  });
});
