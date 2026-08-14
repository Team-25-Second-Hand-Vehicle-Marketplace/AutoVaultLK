import { GroqFallbackService } from './groq-fallback.service';
import { GroqClient, GroqUnavailableError } from './groq-client';
import { FIXTURE_VOCABULARY } from '../parser/fixture-vocabulary';
import type { ParsedQuery } from '../parser/types';

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
    const input = parsed({ needsGroqFallback: false, confidence: 1, filters: { make: ['Toyota'] } });

    const result = await service.repair('toyota aqua', input, FIXTURE_VOCABULARY);

    expect(complete).not.toHaveBeenCalled();
    expect(result.usedLlm).toBe(false);
    expect(result.parsed).toBe(input);
  });

  it('merges whitelisted Groq filters into the rules result', async () => {
    const service = makeService(async () =>
      JSON.stringify({
        filters: { make: ['Honda'], fuelType: ['HYBRID'] },
        consumedTokens: ['sporty'],
      }),
    );

    const result = await service.repair('sporty leather honda', parsed(), FIXTURE_VOCABULARY);

    expect(result.usedLlm).toBe(true);
    expect(result.parsed.filters.make).toEqual(['Honda']);
    expect(result.parsed.filters.fuelType).toEqual(['HYBRID']);
    expect(result.parsed.unresolvedTokens).toEqual(['leather']);
    expect(result.parsed.semanticText).toBe('leather');
  });

  it('falls back to rules-only when Groq is unconfigured (SAD 3.6.2)', async () => {
    const complete = jest.fn();
    const service = makeService(complete, false);
    const input = parsed();

    const result = await service.repair('sporty leather', input, FIXTURE_VOCABULARY);

    expect(complete).not.toHaveBeenCalled();
    expect(result.usedLlm).toBe(false);
    expect(result.parsed).toBe(input);
  });

  it('falls back to rules-only when Groq throws', async () => {
    const input = parsed({ filters: { transmissionType: ['AUTOMATIC'] } });
    const service = makeService(async () => {
      throw new GroqUnavailableError('Groq HTTP 503');
    });

    const result = await service.repair('automatic something', input, FIXTURE_VOCABULARY);

    expect(result.usedLlm).toBe(false);
    expect(result.parsed.filters.transmissionType).toEqual(['AUTOMATIC']);
  });
});
