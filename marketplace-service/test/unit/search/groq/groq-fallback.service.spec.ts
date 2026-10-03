import { GroqFallbackService } from '../../../../src/modules/search/groq/groq-fallback.service';
import {
  GroqClient,
  GroqUnavailableError,
} from '../../../../src/modules/search/groq/groq-client';
import { FIXTURE_VOCABULARY } from '../../../../src/modules/search/parser/fixture-vocabulary';
import type { ParsedQuery } from '../../../../src/modules/search/parser/types';

function parsed(overrides: Partial<ParsedQuery> = {}): ParsedQuery {
  return {
    filters: {},
    semanticText: 'sporty leather',
    unresolvedTokens: ['sporty', 'leather'],
    confidence: 0.2,
    needsGroqFallback: true,
    consumedCount: 0,
    meaningfulCount: 2,
    ...overrides,
  };
}

describe('GroqFallbackService', () => {
  function makeService(complete: GroqClient['complete'], configured = true) {
    const groq = {
      isConfigured: () => configured,
      complete,
    } as unknown as GroqClient;
    return new GroqFallbackService(groq);
  }

  it('does not call Groq when confidence is already high enough', async () => {
    const complete = jest.fn();
    const service = makeService(complete);
    const input = parsed({
      needsGroqFallback: false,
      confidence: 1,
      filters: { make: ['Toyota'] },
    });

    const result = await service.repair(
      'toyota aqua',
      input,
      FIXTURE_VOCABULARY,
    );

    expect(complete).not.toHaveBeenCalled();
    expect(result.usedLlm).toBe(false);
    expect(result.parsed).toBe(input);
  });

  it('merges whitelisted Groq filters into the rules result', async () => {
    const service = makeService(async () =>
      JSON.stringify({
        filters: { make: ['Honda'], fuelType: ['HYBRID'] },
        consumedTokens: ['leather'],
      }),
    );

    const result = await service.repair(
      'sporty leather honda',
      parsed(),
      FIXTURE_VOCABULARY,
    );

    expect(result.usedLlm).toBe(true);
    expect(result.parsed.filters.make).toEqual(['Honda']);
    expect(result.parsed.filters.fuelType).toEqual(['HYBRID']);
    expect(result.parsed.unresolvedTokens).toEqual(['sporty']);
    expect(result.parsed.semanticText).toBe('sporty');
  });

  // The actual bug this guards: "sport cars" used to resolve to
  // vehicleType=CAR (from "cars") plus a hallucinated model correction for
  // "sport" (e.g. an SUV-only model) - an AND of two filters no row can ever
  // satisfy, silently turning a real result set into zero. "sporty" must
  // never be accepted as consumed, and a model Groq proposes that contradicts
  // the rules-resolved vehicleType must be dropped rather than merged in.
  it('refuses to let Groq consume a vehicle-character word or contradict the resolved vehicleType', async () => {
    const service = makeService(async () =>
      JSON.stringify({
        filters: { model: ['Vezel'] }, // Vezel is SUV-only in FIXTURE_VOCABULARY
        consumedTokens: ['sport'],
      }),
    );
    const input = parsed({
      filters: { vehicleType: ['CAR'] },
      semanticText: 'sport',
      unresolvedTokens: ['sport'],
    });

    const result = await service.repair(
      'sport cars',
      input,
      FIXTURE_VOCABULARY,
    );

    expect(result.parsed.filters.model).toBeUndefined();
    expect(result.parsed.filters.vehicleType).toEqual(['CAR']);
    expect(result.parsed.unresolvedTokens).toEqual(['sport']);
    expect(result.parsed.semanticText).toBe('sport');
  });

  it('falls back to rules-only when Groq is unconfigured (SAD 3.6.2)', async () => {
    const complete = jest.fn();
    const service = makeService(complete, false);
    const input = parsed();

    const result = await service.repair(
      'sporty leather',
      input,
      FIXTURE_VOCABULARY,
    );

    expect(complete).not.toHaveBeenCalled();
    expect(result.usedLlm).toBe(false);
    expect(result.parsed).toBe(input);
  });

  it('falls back to rules-only when Groq throws', async () => {
    const input = parsed({ filters: { transmissionType: ['AUTOMATIC'] } });
    const service = makeService(async () => {
      throw new GroqUnavailableError('Groq HTTP 503');
    });

    const result = await service.repair(
      'automatic something',
      input,
      FIXTURE_VOCABULARY,
    );

    expect(result.usedLlm).toBe(false);
    expect(result.parsed.filters.transmissionType).toEqual(['AUTOMATIC']);
  });
});
