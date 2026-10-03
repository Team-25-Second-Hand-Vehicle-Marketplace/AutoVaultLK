import {
  mergeFilters,
  whitelistGroqOutput,
} from '../../../../src/modules/search/groq/groq-whitelist';
import { FIXTURE_VOCABULARY } from '../../../../src/modules/search/parser/fixture-vocabulary';
import { parseGroqJson } from '../../../../src/modules/search/groq/groq-client';

describe('whitelistGroqOutput', () => {
  const unresolved = ['sporty', 'leather', 'honda'];

  it('keeps dictionary makes and drops hallucinations (FR-21.3)', () => {
    const result = whitelistGroqOutput(
      {
        filters: {
          make: ['Honda', 'Cybertruck'],
          fuelType: ['PETROL', 'BANANA'],
        },
        consumedTokens: ['honda'],
      },
      FIXTURE_VOCABULARY,
      unresolved,
    );

    expect(result.filters.make).toEqual(['Honda']);
    expect(result.filters.fuelType).toEqual(['PETROL']);
    expect(result.dropped).toEqual(
      expect.arrayContaining(['make:Cybertruck', 'fuelType:BANANA']),
    );
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

  it('lets "family friendly" be consumed when it resolves a vehicle type', () => {
    const result = whitelistGroqOutput(
      { filters: { vehicleType: ['VAN', 'SUV'] }, consumedTokens: ['family', 'friendly'] },
      FIXTURE_VOCABULARY,
      ['family', 'friendly'],
    );
    expect(result.filters.vehicleType).toEqual(['VAN', 'SUV']);
    expect(result.consumedTokens).toEqual(['family', 'friendly']);
  });

  it('does not let "family" be consumed to justify a make or model', () => {
    const result = whitelistGroqOutput(
      { filters: { make: ['Honda'], vehicleType: ['VAN'] }, consumedTokens: ['family'] },
      FIXTURE_VOCABULARY,
      ['family'],
    );
    expect(result.consumedTokens).toEqual([]);
  });

  // The actual bug: "sport" describes a listing's feel, not a brand, but
  // trigram similarity alone can't tell "sport" from a genuine misspelling
  // of a real model - Groq has no equivalent to the deterministic parser's
  // own denylist for this, so it must be enforced here instead.
  it('refuses to let a vehicle-character word count as consumed, even if Groq claims it', () => {
    const result = whitelistGroqOutput(
      { filters: {}, consumedTokens: ['sporty'] },
      FIXTURE_VOCABULARY,
      unresolved,
    );
    expect(result.consumedTokens).toEqual([]);
    expect(result.dropped).toContain('consumedTokens:sporty:character-word');
  });

  it('drops a model that cannot be the rules-resolved vehicleType', () => {
    // Vezel is SUV-only in FIXTURE_VOCABULARY; a CAR search proposing it is a
    // contradiction, not a correction - keeping it would AND two filters
    // together that can never both be true for any row.
    const result = whitelistGroqOutput(
      { filters: { make: ['Honda'], model: ['Vezel'] }, consumedTokens: [] },
      FIXTURE_VOCABULARY,
      unresolved,
      ['CAR'],
    );
    expect(result.filters.model).toBeUndefined();
    expect(result.dropped).toContain('model:Vezel:vehicleType-mismatch');
  });

  it('keeps a model consistent with the resolved vehicleType', () => {
    const result = whitelistGroqOutput(
      { filters: { make: ['Honda'], model: ['Civic'] }, consumedTokens: [] },
      FIXTURE_VOCABULARY,
      unresolved,
      ['CAR'],
    );
    expect(result.filters.model).toEqual(['Civic']);
  });

  it('does not apply the vehicleType check when rules resolved nothing', () => {
    const result = whitelistGroqOutput(
      { filters: { make: ['Honda'], model: ['Vezel'] }, consumedTokens: [] },
      FIXTURE_VOCABULARY,
      unresolved,
    );
    expect(result.filters.model).toEqual(['Vezel']);
  });

  it('treats a non-object payload as empty rather than throwing', () => {
    expect(whitelistGroqOutput('nope', FIXTURE_VOCABULARY, unresolved)).toEqual(
      {
        filters: {},
        dropped: ['payload'],
        consumedTokens: [],
      },
    );
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
    expect(
      parseGroqJson('```json\n{"filters":{"make":["Honda"]}}\n```'),
    ).toEqual({
      filters: { make: ['Honda'] },
    });
  });
});
