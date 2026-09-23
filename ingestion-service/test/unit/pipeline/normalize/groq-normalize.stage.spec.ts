import {
  groqNormalizeStage,
  selectCandidates,
} from '../../../../src/workers/etl-worker/pipeline/normalize/groq-normalize.stage';
import {
  CONFIDENCE_ALIAS,
  CONFIDENCE_FUZZY,
  InMemoryDictionarySnapshot,
} from '../../../../src/workers/etl-worker/pipeline/normalize/dictionary-snapshot';
import type { DictionaryRow } from '../../../../src/workers/etl-worker/pipeline/normalize/dictionary-snapshot';
import type {
  NormalizedRow,
  StageContext,
} from '../../../../src/workers/etl-worker/pipeline/types';

const dictionaryRow = (
  o: Partial<DictionaryRow> & { id: string; canonicalValue: string },
): DictionaryRow => ({
  parentId: null,
  dictionaryType: 'MAKE',
  aliases: [],
  vehicleTypes: [],
  ...o,
});

const DICTIONARY = new InMemoryDictionarySnapshot([
  dictionaryRow({
    id: 'mk-toyota',
    canonicalValue: 'Toyota',
    vehicleTypes: ['CAR', 'SUV'],
  }),
  dictionaryRow({
    id: 'md-corolla',
    canonicalValue: 'Corolla',
    dictionaryType: 'MODEL',
    parentId: 'mk-toyota',
    vehicleTypes: ['CAR'],
  }),
  dictionaryRow({
    id: 'md-hilux',
    canonicalValue: 'Hilux',
    dictionaryType: 'MODEL',
    parentId: 'mk-toyota',
    vehicleTypes: ['PICKUP'],
  }),
  dictionaryRow({
    id: 'mk-honda',
    canonicalValue: 'Honda',
    vehicleTypes: ['CAR'],
  }),
  dictionaryRow({
    id: 'md-civic',
    canonicalValue: 'Civic',
    dictionaryType: 'MODEL',
    parentId: 'mk-honda',
    vehicleTypes: ['CAR'],
  }),
]);

const row = (confidence: number, rowNumber = 1): NormalizedRow => ({
  rowNumber,
  raw: { make: 'toyta', model: 'corola' },
  normalized: {} as never,
  confidence,
});

const ctx = (threshold = 0.6) =>
  ({
    dictionary: DICTIONARY,
    config: { groqConfidenceThreshold: threshold },
  }) as never as StageContext;

/** Shapes a Groq HTTP response around the model's JSON content. */
const groqResponds = (content: unknown): void => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              typeof content === 'string' ? content : JSON.stringify(content),
          },
        },
      ],
    }),
  }) as never;
};

describe('selectCandidates', () => {
  it('selects rows below the threshold', () => {
    expect(selectCandidates([row(0), row(0.5), row(1)], 0.6)).toHaveLength(2);
  });

  it('leaves a fuzzy dictionary hit alone', () => {
    // A fuzzy hit scores exactly 0.6 and the default threshold is 0.6. The
    // snapshot already vouched for that match with an ambiguity margin; paying
    // for an LLM call to second-guess it would be waste.
    expect(selectCandidates([row(CONFIDENCE_FUZZY)], 0.6)).toHaveLength(0);
  });

  it('honours a configured threshold', () => {
    expect(selectCandidates([row(0.9)], 1)).toHaveLength(1);
    expect(selectCandidates([row(0.9)], 0.5)).toHaveLength(0);
  });
});

describe('groqNormalizeStage', () => {
  const originalKey = process.env.GROQ_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
    global.fetch = originalFetch;
  });

  describe('without a key', () => {
    beforeEach(() => delete process.env.GROQ_API_KEY);

    it('passes every row through', async () => {
      // The keyless path is required behaviour, not a stub: CI has no key, and
      // a dealer upload cannot fail because a third party is unreachable.
      const rows = [row(0, 1), row(1, 2)];
      const result = await groqNormalizeStage.run(ctx(), rows);

      expect(result.rows).toEqual(rows);
      expect(result.outcome).toBe('SKIPPED');
    });

    it('reports how many rows would have been sent', async () => {
      // Visible in the stage log's metrics, so the value of enabling Groq is
      // measurable before anyone pays for it.
      const result = await groqNormalizeStage.run(ctx(), [
        row(0),
        row(0.2),
        row(1),
      ]);

      expect(result.metrics).toEqual({ candidates: 2, repaired: 0 });
    });

    it('treats a whitespace-only key as unconfigured', async () => {
      process.env.GROQ_API_KEY = '   ';

      expect((await groqNormalizeStage.run(ctx(), [row(0)])).outcome).toBe(
        'SKIPPED',
      );
    });
  });

  describe('with a key', () => {
    beforeEach(() => {
      process.env.GROQ_API_KEY = 'test-key';
    });

    it('skips the call when every row already resolved', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as never;

      const result = await groqNormalizeStage.run(ctx(), [row(1), row(1)]);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.outcome).toBe('SKIPPED');
    });

    it('repairs a row from the returned make and model', async () => {
      groqResponds({ rows: [{ id: 1, make: 'Toyota', model: 'Corolla' }] });

      const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

      expect(result.rows[0].normalized).toMatchObject({
        make: 'Toyota',
        model: 'Corolla',
      });
      expect(result.outcome).toBe('SUCCEEDED');
      expect(result.metrics.repaired).toBe(1);
    });

    it('scores a repair below an exact hit', async () => {
      // The LLM agreed with a value we already held; it did not read the
      // vehicle's papers.
      groqResponds({ rows: [{ id: 1, make: 'Toyota', model: 'Corolla' }] });

      const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

      expect(result.rows[0].confidence).toBe(CONFIDENCE_ALIAS);
    });

    it('derives vehicle_type from the repaired model', async () => {
      // Otherwise a repaired Hilux stays typed from the make's array.
      groqResponds({ rows: [{ id: 1, make: 'Toyota', model: 'Hilux' }] });

      const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

      expect(result.rows[0].normalized.vehicleType).toBe('PICKUP');
    });

    describe('provenance (FR-42.1)', () => {
      it('marks the repaired make and model as groq-sourced', async () => {
        groqResponds({
          rows: [
            {
              id: 1,
              make: 'Toyota',
              model: 'Corolla',
              reasoning: 'Fixed the typo.',
            },
          ],
        });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].provenance?.make).toEqual({
          source: 'groq',
          confidence: CONFIDENCE_ALIAS,
          reasoning: 'Fixed the typo.',
        });
        expect(result.rows[0].provenance?.model).toEqual({
          source: 'groq',
          confidence: CONFIDENCE_ALIAS,
          reasoning: 'Fixed the typo.',
        });
      });

      it('omits reasoning when Groq did not supply one', async () => {
        groqResponds({ rows: [{ id: 1, make: 'Toyota', model: 'Corolla' }] });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].provenance?.make).toEqual({
          source: 'groq',
          confidence: CONFIDENCE_ALIAS,
        });
        expect(result.rows[0].provenance?.make).not.toHaveProperty('reasoning');
      });

      // A model paired with the wrong manufacturer is dropped (see the
      // whitelist tests below), so the field the repair never actually wrote
      // must not claim Groq's involvement.
      it('does not mark model as groq-sourced when only the make repaired', async () => {
        groqResponds({ rows: [{ id: 1, make: 'Toyota', model: 'Civic' }] });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].normalized.model).toBeUndefined();
        expect(result.rows[0].provenance?.model).toBeUndefined();
      });

      it('preserves provenance parseNormalize already set for untouched fields', async () => {
        groqResponds({ rows: [{ id: 1, make: 'Toyota', model: 'Corolla' }] });

        const withPriceProvenance: NormalizedRow = {
          ...row(0, 1),
          provenance: { price: { source: 'rule', confidence: 1 } },
        };

        const result = await groqNormalizeStage.run(ctx(), [
          withPriceProvenance,
        ]);

        expect(result.rows[0].provenance?.price).toEqual({
          source: 'rule',
          confidence: 1,
        });
        expect(result.rows[0].provenance?.make?.source).toBe('groq');
      });

      it('clamps reasoning to the storage width', async () => {
        const long = 'x'.repeat(600);
        groqResponds({
          rows: [{ id: 1, make: 'Toyota', model: 'Corolla', reasoning: long }],
        });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].provenance?.make?.reasoning).toHaveLength(500);
      });

      it('leaves provenance untouched for a row Groq was not asked about', async () => {
        groqResponds({ rows: [{ id: 1, make: 'Toyota', model: 'Corolla' }] });

        // Row 2 is not a candidate (confidence 1) and gets no repair entry.
        const untouched: NormalizedRow = { ...row(1, 2) };
        const result = await groqNormalizeStage.run(ctx(), [
          row(0, 1),
          untouched,
        ]);

        expect(result.rows[1].provenance).toBeUndefined();
      });
    });

    it('sends only the candidates, in one call', async () => {
      groqResponds({ rows: [] });

      await groqNormalizeStage.run(ctx(), [row(0, 1), row(1, 2), row(0, 3)]);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body as string,
      ) as { messages: { content: string }[] };
      const payload = JSON.parse(body.messages[1].content) as {
        rows: { id: number }[];
      };

      expect(payload.rows.map((r) => r.id)).toEqual([1, 3]);
    });

    it('supplies the allowed vocabulary in the prompt', async () => {
      groqResponds({ rows: [] });

      await groqNormalizeStage.run(ctx(), [row(0, 1)]);

      const body = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body as string,
      ) as { messages: { content: string }[] };
      const payload = JSON.parse(body.messages[1].content) as {
        allowed: { makes: string[]; models: Record<string, string[]> };
      };

      expect(payload.allowed.makes).toEqual(
        expect.arrayContaining(['Toyota', 'Honda']),
      );
      expect(payload.allowed.models.Toyota).toEqual(
        expect.arrayContaining(['Corolla', 'Hilux']),
      );
    });

    describe('the whitelist', () => {
      it('drops a make that is not in the dictionary', async () => {
        // A prompt is a request, not a constraint. "Lamborghini" would be a
        // make no facet, filter or lookup could ever match.
        groqResponds({
          rows: [{ id: 1, make: 'Lamborghini', model: 'Aventador' }],
        });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].normalized.make).toBeUndefined();
        expect(result.metrics.repaired).toBe(0);
      });

      it('drops an invented model but keeps the valid make', async () => {
        // Supra is a real Toyota, but not one this dictionary carries — and
        // the dictionary is the whole vocabulary the platform can search.
        groqResponds({ rows: [{ id: 1, make: 'Toyota', model: 'Supra' }] });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].normalized.make).toBe('Toyota');
        expect(result.rows[0].normalized.model).toBeUndefined();
      });

      it('accepts a near-miss the dictionary can resolve', async () => {
        // "Corrolla" trigram-matches Corolla at 0.82, unambiguously. Resolving
        // through the snapshot rather than string-comparing turns the model's
        // typo into the canonical value.
        groqResponds({ rows: [{ id: 1, make: 'Toyota', model: 'Corrolla' }] });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].normalized.model).toBe('Corolla');
      });

      it('drops a model paired with the wrong manufacturer', async () => {
        // Civic is a Honda. Writing it under Toyota would create a vehicle
        // that does not exist.
        groqResponds({ rows: [{ id: 1, make: 'Toyota', model: 'Civic' }] });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].normalized.make).toBe('Toyota');
        expect(result.rows[0].normalized.model).toBeUndefined();
      });

      it('writes the dictionary spelling, not the model output', async () => {
        // Resolving rather than string-comparing means the row ends with the
        // same canonical value the deterministic path would have produced.
        groqResponds({ rows: [{ id: 1, make: 'TOYOTA', model: 'corolla' }] });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].normalized).toMatchObject({
          make: 'Toyota',
          model: 'Corolla',
        });
      });

      it('ignores a repair for a row that was never sent', async () => {
        groqResponds({ rows: [{ id: 99, make: 'Toyota', model: 'Corolla' }] });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.metrics.repaired).toBe(0);
      });
    });

    describe('whole-row repair (fuel/transmission/condition/color/engine_capacity_cc/owners_count/location_district)', () => {
      it('repairs a misspelled transmission the exact-match table cannot resolve', async () => {
        // "manul" is not in enum-vocabulary.ts's TRANSMISSION table (no fuzzy
        // fallback there by design), so this is exactly the case Groq exists
        // to repair once given the whole row.
        groqResponds({ rows: [{ id: 1, transmission: 'MANUAL' }] });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].normalized.transmissionType).toBe('MANUAL');
        expect(result.rows[0].provenance?.transmissionType).toMatchObject({
          source: 'groq',
        });
      });

      it('repairs fuel_type, condition, color, engine_capacity_cc, owners_count and location_district together', async () => {
        groqResponds({
          rows: [
            {
              id: 1,
              fuel_type: 'HYBRID',
              condition: 'USED',
              color: 'White',
              engine_capacity_cc: 1500,
              owners_count: 1,
              location_district: 'Colombo',
              reasoning: 'Filled from description.',
            },
          ],
        });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].normalized).toMatchObject({
          fuelType: 'HYBRID',
          condition: 'USED',
          color: 'White',
          engineCapacityCc: 1500,
          ownersCount: 1,
          locationDistrict: 'Colombo',
        });
        expect(result.metrics.repaired).toBe(1);
      });

      it('drops an enum value outside the allowed vocabulary rather than storing it', async () => {
        groqResponds({ rows: [{ id: 1, fuel_type: 'KEROSENE' }] });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].normalized.fuelType).toBeUndefined();
      });

      it('never overwrites a field parseNormalize already resolved', async () => {
        // Groq is asked to repair the whole row for context, but a cell rules
        // already got right must not be replaced by an independent (and
        // possibly different) opinion from the model.
        groqResponds({ rows: [{ id: 1, fuel_type: 'DIESEL' }] });

        const alreadyResolved: NormalizedRow = {
          ...row(0, 1),
          normalized: { fuelType: 'PETROL' } as never,
        };

        const result = await groqNormalizeStage.run(ctx(), [alreadyResolved]);

        expect(result.rows[0].normalized.fuelType).toBe('PETROL');
      });

      it('drops a non-positive or non-integer engine_capacity_cc/owners_count', async () => {
        groqResponds({
          rows: [{ id: 1, engine_capacity_cc: -1500, owners_count: 0 }],
        });

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].normalized.engineCapacityCc).toBeUndefined();
        expect(result.rows[0].normalized.ownersCount).toBeUndefined();
      });

      it('sends the description and the other raw fields in the prompt payload', async () => {
        groqResponds({ rows: [] });

        const withDescription: NormalizedRow = {
          ...row(0, 1),
          raw: {
            make: 'toyta',
            model: 'corola',
            description: '1.5L turbo petrol hybrid, full option',
          },
        };
        await groqNormalizeStage.run(ctx(), [withDescription]);

        const body = JSON.parse(
          (global.fetch as jest.Mock).mock.calls[0][1].body as string,
        ) as { messages: { content: string }[] };
        const payload = JSON.parse(body.messages[1].content) as {
          rows: { description: string }[];
        };

        expect(payload.rows[0].description).toBe(
          '1.5L turbo petrol hybrid, full option',
        );
      });

      it('states the allowed fuel/transmission/condition vocabulary in the prompt', async () => {
        groqResponds({ rows: [] });

        await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        const body = JSON.parse(
          (global.fetch as jest.Mock).mock.calls[0][1].body as string,
        ) as { messages: { content: string }[] };
        const payload = JSON.parse(body.messages[1].content) as {
          allowed: { fuel_type: string[]; transmission: string[]; condition: string[] };
        };

        expect(payload.allowed.fuel_type).toEqual(
          expect.arrayContaining(['PETROL', 'DIESEL', 'HYBRID']),
        );
        expect(payload.allowed.transmission).toEqual(
          expect.arrayContaining(['MANUAL', 'AUTOMATIC']),
        );
        expect(payload.allowed.condition).toEqual(
          expect.arrayContaining(['NEW', 'USED', 'RECONDITIONED']),
        );
      });
    });

    describe('degradation', () => {
      it('keeps deterministic values when the call fails', async () => {
        // Low confidence is not invalidity — validateRows may well accept
        // these. A Groq outage must cost enrichment, not stock.
        global.fetch = jest
          .fn()
          .mockRejectedValue(new Error('network down')) as never;

        const rows = [row(0, 1)];
        const result = await groqNormalizeStage.run(ctx(), rows);

        expect(result.rows).toEqual(rows);
        expect(result.outcome).toBe('DEGRADED');
        expect(result.error).toMatch(/network down/);
      });

      it('degrades on a non-retryable HTTP error without retrying', async () => {
        // A 400 means the request is wrong; retrying spends the timeout twice.
        const fetchSpy = jest
          .fn()
          .mockResolvedValue({ ok: false, status: 400 });
        global.fetch = fetchSpy as never;

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(result.outcome).toBe('DEGRADED');
      });

      it('retries once on 429', async () => {
        const fetchSpy = jest
          .fn()
          .mockResolvedValueOnce({ ok: false, status: 429 })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content:
                      '{"rows":[{"id":1,"make":"Toyota","model":"Corolla"}]}',
                  },
                },
              ],
            }),
          });
        global.fetch = fetchSpy as never;

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(result.outcome).toBe('SUCCEEDED');
      });

      it('degrades on a response that is not JSON', async () => {
        groqResponds('I could not determine the vehicles.');

        expect((await groqNormalizeStage.run(ctx(), [row(0, 1)])).outcome).toBe(
          'DEGRADED',
        );
      });

      it('tolerates a fenced JSON response', async () => {
        // Models wrap JSON in markdown fences despite response_format.
        groqResponds(
          '```json\n{"rows":[{"id":1,"make":"Toyota","model":"Corolla"}]}\n```',
        );

        const result = await groqNormalizeStage.run(ctx(), [row(0, 1)]);

        expect(result.rows[0].normalized.make).toBe('Toyota');
      });

      it('drops a malformed entry without failing the batch', async () => {
        groqResponds({
          rows: [
            { id: 'not-a-number', make: 'Toyota' },
            { id: 2, make: 'Toyota', model: 'Corolla' },
          ],
        });

        const result = await groqNormalizeStage.run(ctx(), [
          row(0, 1),
          row(0, 2),
        ]);

        expect(result.outcome).toBe('SUCCEEDED');
        expect(result.metrics.repaired).toBe(1);
      });
    });

    it('never rejects a row', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('down')) as never;

      const result = await groqNormalizeStage.run(ctx(), [row(0)]);

      expect(result.rejections).toEqual([]);
      expect(result.rows).toHaveLength(1);
    });
  });

  it('is registered as the GROQ_NORMALIZE stage', () => {
    expect(groqNormalizeStage.stage).toBe('GROQ_NORMALIZE');
  });
});
