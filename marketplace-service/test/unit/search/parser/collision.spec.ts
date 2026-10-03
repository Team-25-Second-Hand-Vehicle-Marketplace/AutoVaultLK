import { parseQuery } from '../../../../src/modules/search/parser/deterministic-parser';
import { FIXTURE_VOCABULARY } from '../../../../src/modules/search/parser/fixture-vocabulary';

const parse = (q: string) => parseQuery(q, FIXTURE_VOCABULARY);

describe('closed-enum fuzzy collisions', () => {
  it('does not read "volkswagon" as body_type WAGON', () => {
    // 0.4706 vs "wagon" - over the shared 0.45 gate. Volkswagen is absent
    // from the make dictionary, so nothing outscored it.
    const result = parse('volkswagon');

    expect(result.filters.specs).toBeUndefined();
    // Left unresolved so the Groq fallback gets a chance at it.
    expect(result.confidence).toBe(0);
    expect(result.unresolvedTokens).toEqual(['volkswagon']);
  });

  it.each([
    ['wagon', 'WAGON'],
    ['station wagon', 'WAGON'],
    ['sedan', 'SEDAN'],
    ['sedn', 'SEDAN'],
    ['hachback', 'HATCHBACK'],
    ['hatchbak', 'HATCHBACK'],
  ])('still resolves "%s" to %s', (query, value) => {
    expect(parse(query).filters.specs).toContainEqual({
      key: 'body_type',
      value,
    });
  });

  it.each([
    ['auto', 'transmissionType', 'AUTOMATIC'],
    ['petrol', 'fuelType', 'PETROL'],
    ['deisel', 'fuelType', 'DIESEL'],
  ])('keeps closed-enum typo "%s" resolving to %s=%s', (query, field, value) => {
    expect(parse(query).filters[field as 'fuelType']).toContain(value);
  });
});
