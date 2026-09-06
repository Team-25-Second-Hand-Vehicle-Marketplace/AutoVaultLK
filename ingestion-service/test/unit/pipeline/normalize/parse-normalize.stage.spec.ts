import { InMemoryDictionarySnapshot } from '../../../../src/workers/etl-worker/pipeline/normalize/dictionary-snapshot';
import type { DictionaryRow } from '../../../../src/workers/etl-worker/pipeline/normalize/dictionary-snapshot';
import { parseNormalizeStage } from '../../../../src/workers/etl-worker/pipeline/normalize/parse-normalize.stage';
import type {
  RawRow,
  StageContext,
} from '../../../../src/workers/etl-worker/pipeline/types';

const row = (o: Partial<DictionaryRow> & { id: string; canonicalValue: string }): DictionaryRow => ({
  parentId: null,
  dictionaryType: 'MAKE',
  aliases: [],
  vehicleTypes: [],
  ...o,
});

/** Toyota carries five types, so its array is ambiguous — deliberately. */
const DICTIONARY = new InMemoryDictionarySnapshot([
  row({
    id: 'mk-toyota',
    canonicalValue: 'Toyota',
    aliases: ['toyata'],
    vehicleTypes: ['CAR', 'SUV', 'VAN', 'PICKUP', 'LORRY'],
  }),
  row({
    id: 'md-vitz',
    canonicalValue: 'Vitz',
    dictionaryType: 'MODEL',
    parentId: 'mk-toyota',
    aliases: ['vits'],
    vehicleTypes: ['CAR'],
  }),
  row({
    id: 'md-hilux',
    canonicalValue: 'Hilux',
    dictionaryType: 'MODEL',
    parentId: 'mk-toyota',
    vehicleTypes: ['PICKUP'],
  }),
  row({ id: 'mk-honda', canonicalValue: 'Honda', vehicleTypes: ['CAR'] }),
  row({
    id: 'md-civic',
    canonicalValue: 'Civic',
    dictionaryType: 'MODEL',
    parentId: 'mk-honda',
    vehicleTypes: ['CAR'],
  }),
  // Single-type make: unambiguous, so an unresolved model can still inherit.
  row({ id: 'mk-jcb', canonicalValue: 'JCB', vehicleTypes: ['HEAVY_MACHINERY'] }),
]);

/** Only `dictionary` is reached; a stage touching more would be a contract breach. */
const ctx = { dictionary: DICTIONARY } as never as StageContext;

const raw = (cells: Record<string, string>, rowNumber = 1): RawRow => ({ rowNumber, raw: cells });

const normalize = async (cells: Record<string, string>) => {
  const result = await parseNormalizeStage.run(ctx, [raw(cells)]);
  return result.rows[0];
};

const VALID = {
  make: 'Toyota',
  model: 'Vitz',
  year: '2015',
  price: '3500000',
  mileage: '45000',
};

describe('parseNormalizeStage', () => {
  it('resolves make and model to canonical values', async () => {
    const result = await normalize({ ...VALID, make: 'toyata', model: 'vits' });

    expect(result.normalized.make).toBe('Toyota');
    expect(result.normalized.model).toBe('Vitz');
  });

  it('coerces numerics, stripping currency and units', async () => {
    const result = await normalize({
      ...VALID,
      price: 'Rs. 3,500,000',
      mileage: '45,000 km',
      engine_capacity_cc: '1300cc',
    });

    expect(result.normalized.price).toBe(3_500_000);
    expect(result.normalized.mileage).toBe(45_000);
    expect(result.normalized.engineCapacityCc).toBe(1_300);
  });

  it('derives vehicle_type from the matched model', async () => {
    // migration 21000 put vehicle_types[] on the dictionary precisely so the
    // dealer CSV need not carry the column. A Hilux is a PICKUP.
    const result = await normalize({ ...VALID, model: 'Hilux' });

    expect(result.normalized.vehicleType).toBe('PICKUP');
  });

  it('prefers an explicit vehicle_type over the dictionary', async () => {
    const result = await normalize({ ...VALID, model: 'Hilux', vehicle_type: 'lorry' });

    expect(result.normalized.vehicleType).toBe('LORRY');
  });

  it('refuses to guess a type from a multi-type make', async () => {
    // Toyota is CAR, SUV, VAN, PICKUP and LORRY. Taking the first would type
    // every unresolved Toyota as a car, lorries included.
    const result = await normalize({ ...VALID, model: 'Unknownmodel' });

    expect(result.normalized.vehicleType).toBeUndefined();
  });

  it('inherits the type from a single-type make when the model is unknown', async () => {
    const result = await normalize({ ...VALID, make: 'JCB', model: 'Unknownmodel' });

    expect(result.normalized.vehicleType).toBe('HEAVY_MACHINERY');
  });

  it('scopes the model to its make', async () => {
    // A Civic under Toyota is not Honda's Civic — the dealer typed something
    // wrong, and resolving it anyway would write a vehicle that does not exist.
    const result = await normalize({ ...VALID, make: 'Toyota', model: 'Civic' });

    expect(result.normalized.model).toBeUndefined();
    expect(result.confidence).toBe(0);
  });

  it('scores an exact match at full confidence', async () => {
    const result = await normalize(VALID);

    expect(result.confidence).toBe(1);
  });

  it('takes the minimum confidence, not the mean', async () => {
    // A row whose make resolved exactly but whose model did not is not 80%
    // correct; it is wrong where it matters. Averaging would hide that behind
    // four confident cells and skip the Groq fallback.
    const result = await normalize({ ...VALID, make: 'toyata', model: 'Vitz' });

    expect(result.confidence).toBe(0.8);
  });

  it('does not penalise a blank optional field', async () => {
    // Most dealer sheets carry five columns. Scoring absent colour as a miss
    // would drag every row below the threshold and send the whole file to an
    // LLM that has nothing to work with.
    const result = await normalize({ ...VALID, color: '', description: '' });

    expect(result.confidence).toBe(1);
  });

  it('penalises a field the dealer filled in with something unrecognised', async () => {
    const result = await normalize({ ...VALID, fuel_type: 'nuclear' });

    expect(result.confidence).toBe(0);
    expect(result.normalized.fuelType).toBeUndefined();
  });

  it('never rejects a row, even one with nothing resolvable', async () => {
    // validateRows is the single gate, so every rejection reason lives in one
    // place — and Groq still gets a chance at rows this stage could not read.
    const result = await parseNormalizeStage.run(ctx, [
      raw({ make: 'Lamborghini', model: 'Aventador', year: 'x', price: 'x', mileage: 'x' }),
    ]);

    expect(result.rejections).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].confidence).toBe(0);
  });

  it('leaves an unparseable field absent rather than writing null over it', async () => {
    // validateRows distinguishes "missing" from "present but wrong" using
    // exactly this.
    const result = await normalize({ ...VALID, price: 'call me' });

    expect('price' in result.normalized).toBe(false);
  });

  it('normalizes the registration number to the indexed form', async () => {
    const result = await normalize({ ...VALID, registration_number: 'cab 1234' });

    expect(result.normalized.registrationNumber).toBe('CAB-1234');
  });

  it('leaves an unregistered import without a registration number', async () => {
    const result = await normalize({ ...VALID, registration_number: '' });

    expect(result.normalized.registrationNumber).toBeUndefined();
  });

  it('does not default condition — enrich owns that', async () => {
    // Defaulting in two places would make the default impossible to find.
    const result = await normalize(VALID);

    expect(result.normalized.condition).toBeUndefined();
  });

  it('preserves rowNumber and the raw cells for the rejection report', async () => {
    const result = await parseNormalizeStage.run(ctx, [raw(VALID, 42)]);

    expect(result.rows[0].rowNumber).toBe(42);
    expect(result.rows[0].raw).toEqual(VALID);
  });

  it('is registered as the PARSE_NORMALIZE stage', () => {
    expect(parseNormalizeStage.stage).toBe('PARSE_NORMALIZE');
  });
});
