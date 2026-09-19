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

  describe('boolean equipment specs', () => {
    it.each([
      ['full_option', 'full_option'],
      ['fulloption', 'full_option'],
      ['alloys', 'alloy_wheels'],
      ['reverse_camera', 'reverse_camera'],
      ['ac', 'air_conditioning'],
      ['leather', 'leather_seats'],
    ])('maps the dealer column %s to specs.%s', async (column, key) => {
      // Every target key must exist in marketplace's KNOWN_SPEC_KEYS, or
      // filter-query.builder.ts rejects it and the value is unqueryable.
      const result = await enrich(row({}, { [column]: 'yes' }));

      expect(result.normalized.specs).toMatchObject({ [key]: true });
    });

    it('records an explicit false', async () => {
      expect((await enrich(row({}, { sunroof: 'no' }))).normalized.specs).toEqual({
        sunroof: false,
      });
    });

    it('lets the first column win when two aliases target one key', async () => {
      // "alloys" and "alloy_wheels" in the same file map to one key; a later
      // blank must not overwrite an earlier true.
      const result = await enrich(row({}, { alloy_wheels: 'yes', alloys: '' }));

      expect(result.normalized.specs).toMatchObject({ alloy_wheels: true });
    });

    it('omits the key when the cell is blank or unreadable', async () => {
      expect((await enrich(row({}, { sunroof: '' }))).normalized.specs).toBeUndefined();
      expect((await enrich(row({}, { sunroof: 'maybe' }))).normalized.specs).toBeUndefined();
    });
  });

  describe('unmapped dealer columns', () => {
    it('carries them into the description rather than dropping them', async () => {
      // "Warranty: 2 years" is real information a buyer would search for, and
      // dropping it silently loses the only place it existed. It cannot go in
      // specs — that column is queried against KNOWN_SPEC_KEYS, so an unknown
      // key is unqueryable weight that still looks like data.
      const result = await enrich(row({}, { warranty: '2 years', service_records: 'full' }));

      expect(result.normalized.specs).toBeUndefined();
      expect(result.normalized.description).toBe('Warranty: 2 years. Service records: full.');
    });

    it('appends to a description the dealer already wrote', async () => {
      const result = await enrich(
        row({ description: 'Excellent condition.' }, { warranty: '2 years' }),
      );

      expect(result.normalized.description).toBe('Excellent condition. Warranty: 2 years.');
    });

    it('does not repeat something the description already says', async () => {
      const result = await enrich(
        row({ description: 'Comes with a body kit.' }, { extras: 'body kit' }),
      );

      expect(result.normalized.description).toBe('Comes with a body kit.');
    });

    it('ignores columns the pipeline already consumed', async () => {
      // make/model/price are vehicle fields, not extras; echoing them into the
      // description would duplicate them in the search text.
      const result = await enrich(row({}, { make: 'Toyota', price: '3500000', year: '2015' }));

      expect(result.normalized.description).toBeUndefined();
    });

    it('ignores blank columns', async () => {
      expect((await enrich(row({}, { warranty: '   ' }))).normalized.description).toBeUndefined();
    });

    it('caps how much it appends', async () => {
      // A dealer export with forty internal columns would otherwise bury what
      // they actually wrote and dominate the embedding's input.
      const raw: Record<string, string> = {};
      for (let i = 0; i < 20; i++) raw[`extra_${i}`] = `value ${i}`;

      const description = (await enrich(row({}, raw))).normalized.description ?? '';

      expect(description.split('. ')).toHaveLength(8);
    });

    it('truncates an over-long value', async () => {
      const result = await enrich(row({}, { notes_internal: 'x'.repeat(200) }));

      expect((result.normalized.description ?? '').length).toBeLessThan(100);
    });
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
