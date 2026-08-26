import { mergeFilters, whitelistGroqOutput } from '../../../../src/modules/search/groq/groq-whitelist';
import { FIXTURE_VOCABULARY } from '../../../../src/modules/search/parser/fixture-vocabulary';
import { parseGroqJson } from '../../../../src/modules/search/groq/groq-client';

describe('whitelistGroqOutput', () => {
  const unresolved = ['sporty', 'leather', 'honda'];

  it('keeps dictionary makes and drops hallucinations (FR-21.3)', () => {
    const result = whitelistGroqOutput(
      {
        filters: { make: ['Honda', 'Cybertruck'], fuelType: ['PETROL', 'BANANA'] },
        consumedTokens: ['honda'],
      },
      FIXTURE_VOCABULARY,
      unresolved,
    );

    expect(result.filters.make).toEqual(['Honda']);
    expect(result.filters.fuelType).toEqual(['PETROL']);
    expect(result.dropped).toEqual(expect.arrayContaining(['make:Cybertruck', 'fuelType:BANANA']));
    expect(result.consumedTokens).toEqual(['honda']);
  });

  it('rejects a model that does not belong to the resolved make', () => {
    const result = whitelistGroqOutput(
      { filters: { make: ['Honda'], model: ['Corolla'] }, consumedTokens: [] },
      FIXTURE_VOCABULARY,
      unresolved,
    );
    expect(result.filters.model).toBeUndefined();
    expect(result.dropped).toContain('model:Corolla');
  });

  it('accepts Civic under Honda and known spec keys only', () => {
    const result = whitelistGroqOutput(
      {
        filters: {
          make: ['Honda'],
          model: ['Civic'],
          specs: [
            { key: 'sunroof', value: 'true' },
            { key: 'turbo', value: 'yes' },
          ],
        },
      },
      FIXTURE_VOCABULARY,
      unresolved,
    );
    expect(result.filters.model).toEqual(['Civic']);
    expect(result.filters.specs).toEqual([{ key: 'sunroof', value: 'true' }]);
    expect(result.dropped).toContain('specs:turbo');
  });

  it('drops consumedTokens that were not in the parser leftover list', () => {
    const result = whitelistGroqOutput(
      { filters: {}, consumedTokens: ['injected'] },
      FIXTURE_VOCABULARY,
      unresolved,
    );
    expect(result.consumedTokens).toEqual([]);
    expect(result.dropped).toContain('consumedTokens:injected');
  });

  it('treats a non-object payload as empty rather than throwing', () => {
    expect(whitelistGroqOutput('nope', FIXTURE_VOCABULARY, unresolved)).toEqual({
      filters: {},
      dropped: ['payload'],
      consumedTokens: [],
    });
  });
});

describe('mergeFilters', () => {
  it('lets rules-parsed fields win over Groq on conflict', () => {
    const merged = mergeFilters(
      { make: ['Toyota'], maxPrice: 8_500_000 },
      { make: ['Honda'], fuelType: ['HYBRID'], maxPrice: 1 },
    );
    expect(merged.make).toEqual(['Toyota']);
    expect(merged.maxPrice).toBe(8_500_000);
    expect(merged.fuelType).toEqual(['HYBRID']);
  });
});

describe('parseGroqJson', () => {
  it('extracts JSON from a fenced completion', () => {
    expect(parseGroqJson('```json\n{"filters":{"make":["Honda"]}}\n```')).toEqual({
      filters: { make: ['Honda'] },
    });
  });
});
