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
      // A value no search facet can filter on is worse than an absent one - it
      // looks like data.
      expect((await enrich(row({}, { body_type: 'limousine' }))).normalized.specs).toBeUndefined();
    });

    it('is set before embed runs, since buildSearchText reads it', async () => {
      // A bulk row without body_type produces a shorter search text than the
      // equivalent manual listing, and a different text embeds to a different
      // vector - FR-22.1 drift through the side door.
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

  describe('category-gated specs (SRS Appendix B.2)', () => {
    it('ignores CAR/SUV-only columns on a non-CAR/SUV vehicle_type', async () => {
      // A TRUCK row with a seats/doors/drive_type column should not get a CAR
      // cabin spec - the column describes the wrong category of vehicle.
      const result = await enrich(
        row({ vehicleType: 'TRUCK' }, { seats: '5', doors: '4', drive_type: '4wd' }),
      );

      expect(result.normalized.specs).toBeUndefined();
    });

    it('reads BIKE-only specs only when vehicle_type is BIKE', async () => {
      const bike = await enrich(
        row(
          { vehicleType: 'BIKE' },
          { stroke_type: '4-stroke', cooling_system: 'liquid', start_type: 'electric', abs: 'yes' },
        ),
      );

      expect(bike.normalized.specs).toEqual({
        stroke_type: '4_STROKE',
        cooling_system: 'LIQUID',
        start_type: 'ELECTRIC',
        abs_equipped: true,
      });

      // Same columns on a CAR row are ignored - a car has no stroke_type.
      const car = await enrich(
        row({ vehicleType: 'CAR' }, { stroke_type: '4-stroke', cooling_system: 'liquid' }),
      );
      expect(car.normalized.specs).toBeUndefined();
    });

    it('reads VAN/BUS-only specs only when vehicle_type is VAN or BUS', async () => {
      const van = await enrich(
        row(
          { vehicleType: 'VAN' },
          { seating_capacity: '12', roof_type: 'high roof', wheelbase: 'long', door_configuration: 'sliding' },
        ),
      );

      expect(van.normalized.specs).toEqual({
        seating_capacity: 12,
        roof_type: 'HIGH_ROOF',
        wheelbase: 'LONG',
        door_configuration: 'SLIDING',
      });

      const bus = await enrich(row({ vehicleType: 'BUS' }, { seating_capacity: '40' }));
      expect(bus.normalized.specs).toEqual({ seating_capacity: 40 });
    });

    it('reads TRUCK-only specs only when vehicle_type is a truck category', async () => {
      const truck = await enrich(
        row(
          { vehicleType: 'TRUCK' },
          {
            load_capacity_kg: '5000',
            payload_capacity_kg: '4500',
            axle_count: '3',
            cargo_bed_type: 'flatbed',
          },
        ),
      );

      expect(truck.normalized.specs).toEqual({
        load_capacity_kg: 5000,
        payload_capacity_kg: 4500,
        axle_count: 3,
        cargo_bed_type: 'FLATBED',
      });

      // LORRY and PICKUP share the truck category.
      const lorry = await enrich(row({ vehicleType: 'LORRY' }, { axle_count: '2' }));
      expect(lorry.normalized.specs).toEqual({ axle_count: 2 });
    });

    it('applies universal equipment specs regardless of vehicle_type', async () => {
      // A van or truck can have a sunroof too - these are not category-gated.
      const result = await enrich(
        row({ vehicleType: 'TRUCK' }, { sunroof: 'yes', full_option: 'yes' }),
      );

      expect(result.normalized.specs).toEqual({ sunroof: true, full_option: true });
    });

    it('drops a category enum value outside its allowed list', async () => {
      const result = await enrich(row({ vehicleType: 'BIKE' }, { stroke_type: 'rotary' }));

      expect(result.normalized.specs).toBeUndefined();
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
    it('carries them into both specs (verbatim) and the description, rather than dropping them', async () => {
      // "Warranty: 2 years" is real information a buyer would search for, and
      // dropping it silently loses the only place it existed. It is written to
      // specs verbatim so the dealer's own data survives structurally (FR-15 /
      // Appendix B.2), and to description so it still reaches the embedding -
      // no search facet queries an unknown specs key, but that is a filtering
      // limitation, not a reason to lose the data.
      const result = await enrich(row({}, { warranty: '2 years', service_records: 'full' }));

      expect(result.normalized.specs).toEqual({
        warranty: '2 years',
        service_records: 'full',
      });
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

    it('caps how much it appends to the description', async () => {
      // A dealer export with forty internal columns would otherwise bury what
      // they actually wrote and dominate the embedding's input.
      const raw: Record<string, string> = {};
      for (let i = 0; i < 20; i++) raw[`extra_${i}`] = `value ${i}`;

      const description = (await enrich(row({}, raw))).normalized.description ?? '';

      expect(description.split('. ')).toHaveLength(8);
    });

    it('caps how many unmapped columns land in specs', async () => {
      // Separate cap from the description's: a dealer export with dozens of
      // DMS columns should not turn specs into an unbounded bag either.
      const raw: Record<string, string> = {};
      for (let i = 0; i < 30; i++) raw[`extra_${i}`] = `value ${i}`;

      const specs = (await enrich(row({}, raw))).normalized.specs ?? {};

      expect(Object.keys(specs)).toHaveLength(20);
    });

    it('truncates an over-long value in the description', async () => {
      const result = await enrich(row({}, { notes_internal: 'x'.repeat(200) }));

      expect((result.normalized.description ?? '').length).toBeLessThan(100);
    });

    it('truncates an over-long value in specs', async () => {
      const result = await enrich(row({}, { notes_internal: 'x'.repeat(300) }));

      expect((result.normalized.specs?.notes_internal as string).length).toBeLessThanOrEqual(200);
    });
  });

  it('leaves specs absent when nothing produced one', async () => {
    expect((await enrich(row())).normalized.specs).toBeUndefined();
  });

  it('never rejects a row - it only adds', async () => {
    const result = await enrichStage.run(ctx, [row(), row()]);

    expect(result.rejections).toEqual([]);
    expect(result.rows).toHaveLength(2);
  });

  it('is registered as the ENRICH stage', () => {
    expect(enrichStage.stage).toBe('ENRICH');
  });
});

describe('values that do not apply to the vehicle type', () => {
  const type = (vehicleType: VehicleFields['vehicleType']) => ({ vehicleType });

  it('does not store a sunroof on a bike, and flags the row for review', async () => {
    const out = await enrich(row(type('BIKE'), { sunroof: 'Yes' }));

    expect(out.normalized.specs?.sunroof).toBeUndefined();
    expect(out.provenance?.specs?.reasoning).toMatch(/Ignored for a bike: sunroof/);
    expect(out.provenance?.specs?.confidence).toBeLessThan(0.6);
  });

  it('lowers the row confidence so the row sorts to the top of the review queue', async () => {
    const out = await enrich(row(type('BIKE'), { sunroof: 'yes' }));

    expect(out.confidence).toBeLessThan(0.6);
  });

  it('names every ignored column in one note', async () => {
    const out = await enrich(
      row(type('BIKE'), { sunroof: 'yes', leather_seats: 'true', air_conditioning: 'y' }),
    );

    const note = out.provenance?.specs?.reasoning ?? '';
    expect(note).toMatch(/sunroof/);
    expect(note).toMatch(/leather seats/);
    expect(note).toMatch(/air conditioning/);
    expect(note).toMatch(/They do not apply/);
  });

  it('keeps alloy wheels on a bike, which is a real feature there', async () => {
    const out = await enrich(row(type('BIKE'), { alloy_wheels: 'yes' }));

    expect(out.normalized.specs).toMatchObject({ alloy_wheels: true });
    expect(out.provenance?.specs).toBeUndefined();
  });

  it('does not flag a plain "no" or a blank, which are true or simply empty', async () => {
    const out = await enrich(row(type('BIKE'), { sunroof: 'no', leather_seats: '', abs: 'yes' }));

    expect(out.provenance?.specs).toBeUndefined();
    expect(out.confidence).toBe(1);
  });

  it('still allows a sunroof on a van or truck, where a cab can have one', async () => {
    const van = await enrich(row(type('VAN'), { sunroof: 'yes' }));
    const truck = await enrich(row(type('TRUCK'), { air_conditioning: 'yes' }));

    expect(van.normalized.specs).toMatchObject({ sunroof: true });
    expect(truck.normalized.specs).toMatchObject({ air_conditioning: true });
    expect(van.provenance?.specs).toBeUndefined();
  });

  it('flags a bike-only column on a car instead of dropping it silently', async () => {
    const out = await enrich(row(type('CAR'), { stroke_type: '4-Stroke' }));

    expect(out.normalized.specs?.stroke_type).toBeUndefined();
    expect(out.provenance?.specs?.reasoning).toMatch(/Ignored for a car: stroke type/);
  });

  it('flags a truck column on a car, and uses the singular for one column', async () => {
    const out = await enrich(row(type('CAR'), { axle_count: '3' }));

    expect(out.provenance?.specs?.reasoning).toMatch(/It does not apply/);
  });

  it('leaves a correctly typed row alone', async () => {
    const out = await enrich(row(type('BIKE'), { stroke_type: '4-Stroke', abs_equipped: 'yes' }));

    expect(out.normalized.specs).toMatchObject({ stroke_type: '4_STROKE', abs_equipped: true });
    expect(out.provenance?.specs).toBeUndefined();
    expect(out.confidence).toBe(1);
  });

  it('keeps provenance the pipeline already recorded for other fields', async () => {
    const r = row(type('BIKE'), { sunroof: 'yes' });
    r.provenance = { make: { source: 'dictionary', confidence: 1 } };

    const out = await enrich(r);

    expect(out.provenance?.make).toEqual({ source: 'dictionary', confidence: 1 });
    expect(out.provenance?.specs).toBeDefined();
  });
});

describe('a vehicle type the dealer wrote that we could not read', () => {
  it('flags it at low confidence and says which type was used instead', async () => {
    const out = await enrich(row({ vehicleType: 'CAR' }, { vehicle_type: 'Hoverboard' }));

    expect(out.provenance?.vehicleType?.confidence).toBeLessThan(0.6);
    expect(out.provenance?.vehicleType?.reasoning).toMatch(
      /Vehicle type "Hoverboard" was not recognised, so "car" was used/,
    );
    expect(out.confidence).toBeLessThan(0.6);
  });

  it('does not flag a type that was read, or a blank cell filled in from the model', async () => {
    const read = await enrich(row({ vehicleType: 'PICKUP' }, { vehicle_type: 'Pick-up' }));
    const blank = await enrich(row({ vehicleType: 'PICKUP' }, { vehicle_type: '' }));

    expect(read.provenance?.vehicleType).toBeUndefined();
    expect(blank.provenance?.vehicleType).toBeUndefined();
    expect(blank.confidence).toBe(1);
  });

  it('reports both problems when the type was unreadable and a column does not apply', async () => {
    const out = await enrich(
      row({ vehicleType: 'CAR' }, { vehicle_type: 'Hoverboard', stroke_type: '4-Stroke' }),
    );

    expect(out.provenance?.vehicleType?.reasoning).toMatch(/not recognised/);
    expect(out.provenance?.specs?.reasoning).toMatch(/Ignored for a car: stroke type/);
  });
});
