import {
  DEFAULT_CONDITION,
  enrichStage,
} from '../../../../src/workers/etl-worker/pipeline/enrich/enrich.stage';
import { InMemoryDictionarySnapshot } from '../../../../src/workers/etl-worker/pipeline/normalize/dictionary-snapshot';
import type { DictionaryRow } from '../../../../src/workers/etl-worker/pipeline/normalize/dictionary-snapshot';
import type {
  StageContext,
  ValidatedRow,
  VehicleFields,
} from '../../../../src/workers/etl-worker/pipeline/types';

const bodyType = (canonicalValue: string, aliases: string[] = []): DictionaryRow => ({
  id: `bt-${canonicalValue}`,
  parentId: null,
  dictionaryType: 'BODY_TYPE',
  canonicalValue,
  aliases,
  vehicleTypes: [],
});

const DICTIONARY = new InMemoryDictionarySnapshot([
  bodyType('SEDAN', ['saloon']),
  bodyType('SUV', ['jeep']),
  bodyType('HATCHBACK', ['hatch']),
]);

const ctx = { dictionary: DICTIONARY } as never as StageContext;

const VALID: VehicleFields = {
  vehicleType: 'CAR',
  make: 'Toyota',
  model: 'Vitz',
  condition: 'USED',
  manufactureYear: 2015,
  price: 3_500_000,
  mileage: 45_000,
};

const row = (
  overrides: Partial<VehicleFields> = {},
  raw: Record<string, string> = {},
): ValidatedRow => ({
  rowNumber: 1,
  raw,
  normalized: { ...VALID, ...overrides },
  confidence: 1,
});

const enrich = async (r: ValidatedRow) => (await enrichStage.run(ctx, [r])).rows[0];

describe('enrichStage', () => {
  it('defaults condition when parseNormalize left it absent', async () => {
    // parseNormalize deliberately does not default, so the value lives in
    // exactly one place and is findable.
    const r = row();
    delete (r.normalized as Record<string, unknown>).condition;

    expect((await enrich(r)).normalized.condition).toBe(DEFAULT_CONDITION);
  });

  it('does not overwrite a condition the dealer supplied', async () => {
    expect((await enrich(row({ condition: 'RECONDITIONED' }))).normalized.condition).toBe(
      'RECONDITIONED',
    );
  });

  it('defaults is_negotiable to false', async () => {
    expect((await enrich(row())).normalized.isNegotiable).toBe(false);
  });

  describe('specs.body_type', () => {
    it('resolves through the dictionary so seed aliases apply', async () => {
      // "saloon" and "jeep" are Sri Lankan usage and already in the seed.
      expect((await enrich(row({}, { body_type: 'saloon' }))).normalized.specs).toEqual({
        body_type: 'SEDAN',
      });
      expect((await enrich(row({}, { body_type: 'jeep' }))).normalized.specs).toEqual({
        body_type: 'SUV',
      });
    });

    it('accepts a canonical value directly', async () => {
      expect((await enrich(row({}, { body_type: 'Hatchback' }))).normalized.specs).toEqual({
        body_type: 'HATCHBACK',
      });
    });

    it('drops a body type outside KNOWN_SPEC_KEYS', async () => {
      // A value no search facet can filter on is worse than an absent one — it
      // looks like data.
      expect((await enrich(row({}, { body_type: 'limousine' }))).normalized.specs).toBeUndefined();
    });

    it('is set before embed runs, since buildSearchText reads it', async () => {
      // A bulk row without body_type produces a shorter search text than the
      // equivalent manual listing, and a different text embeds to a different
      // vector — FR-22.1 drift through the side door.
      const result = await enrich(row({}, { body_type: 'saloon' }));

      expect(result.normalized.specs).toHaveProperty('body_type');
    });
  });

  describe('int specs', () => {
    it('carries values within range', async () => {
      const result = await enrich(row({}, { seats: '5', doors: '4', airbags: '6' }));

      expect(result.normalized.specs).toMatchObject({ seats: 5, doors: 4, airbags: 6 });
    });

    it('drops an out-of-range value rather than clamping it', async () => {
      // 200 seats is a typo; clamping to 60 would invent a plausible fact.
      const result = await enrich(row({}, { seats: '200' }));

      expect(result.normalized.specs).toBeUndefined();
    });

    it('drops a non-numeric value', async () => {
      expect((await enrich(row({}, { doors: 'four' }))).normalized.specs).toBeUndefined();
    });
  });

  it('normalizes drive_type', async () => {
    expect((await enrich(row({}, { drive_type: '4wd' }))).normalized.specs).toEqual({
      drive_type: '4WD',
    });
  });

  it('reads sunroof as a boolean', async () => {
    expect((await enrich(row({}, { sunroof: 'yes' }))).normalized.specs).toEqual({
      sunroof: true,
    });
    expect((await enrich(row({}, { sunroof: 'no' }))).normalized.specs).toEqual({
      sunroof: false,
    });
  });

  it('drops unknown dealer columns', async () => {
    // specs is queried against KNOWN_SPEC_KEYS; an arbitrary column stored
    // there is unqueryable weight on every row.
    const result = await enrich(row({}, { dealer_stock_code: 'ABC123', warranty: '2 years' }));

    expect(result.normalized.specs).toBeUndefined();
  });

  it('leaves specs absent rather than writing an empty object', async () => {
    expect((await enrich(row())).normalized.specs).toBeUndefined();
  });

  it('never rejects a row — it only adds', async () => {
    const result = await enrichStage.run(ctx, [row(), row()]);

    expect(result.rejections).toEqual([]);
    expect(result.rows).toHaveLength(2);
  });

  it('is registered as the ENRICH stage', () => {
    expect(enrichStage.stage).toBe('ENRICH');
  });
});
