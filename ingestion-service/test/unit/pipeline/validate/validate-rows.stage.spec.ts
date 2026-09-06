import {
  MAX_MILEAGE,
  MAX_PRICE,
  MIN_YEAR,
  validateRowsStage,
} from '../../../../src/workers/etl-worker/pipeline/validate/validate-rows.stage';
import type {
  NormalizedRow,
  StageContext,
  VehicleFields,
} from '../../../../src/workers/etl-worker/pipeline/types';

const ctx = {} as never as StageContext;

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
  o: { rowNumber?: number; raw?: Record<string, string> } = {},
): NormalizedRow => ({
  rowNumber: o.rowNumber ?? 1,
  raw: o.raw ?? {},
  normalized: { ...VALID, ...overrides },
  confidence: 1,
});

/** Drops a key entirely — absent is distinct from present-and-invalid here. */
const without = (key: keyof VehicleFields, o?: { raw?: Record<string, string> }): NormalizedRow => {
  const r = row({}, o);
  delete (r.normalized as Record<string, unknown>)[key];
  return r;
};

const run = (rows: NormalizedRow[]) => validateRowsStage.run(ctx, rows);

describe('validateRowsStage', () => {
  it('passes a complete row through', async () => {
    const result = await run([row()]);

    expect(result.rows).toHaveLength(1);
    expect(result.rejections).toEqual([]);
  });

  it.each(['make', 'model', 'manufactureYear', 'price', 'mileage'] as const)(
    'rejects a row missing %s',
    async (field) => {
      const result = await run([without(field)]);

      expect(result.rows).toHaveLength(0);
      expect(result.rejections).toHaveLength(1);
    },
  );

  it('distinguishes a blank cell from an unrecognised value', async () => {
    // Different fixes: one means "you left this empty", the other means "we do
    // not carry this make". A single message for both helps nobody.
    const blank = await run([without('make', { raw: { make: '' } })]);
    const unknown = await run([without('make', { raw: { make: 'Lamborghini' } })]);

    expect(blank.rejections[0].reason).toBe('make is missing');
    expect(unknown.rejections[0].reason).toBe('make "Lamborghini" could not be recognised');
  });

  it('collects every problem in one rejection rather than stopping at the first', async () => {
    // A dealer fixing one error per upload round-trip is the failure mode this
    // avoids.
    const result = await run([row({ price: -1, mileage: -5, manufactureYear: 1800 })]);

    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toMatch(/price/);
    expect(result.rejections[0].reason).toMatch(/mileage/);
    expect(result.rejections[0].reason).toMatch(/year/);
  });

  describe('ranges', () => {
    it('rejects a year before the floor', async () => {
      const result = await run([row({ manufactureYear: MIN_YEAR - 1 })]);
      expect(result.rejections[0].reason).toMatch(/outside/);
    });

    it('accepts next year, for unregistered new stock', async () => {
      const result = await run([row({ manufactureYear: new Date().getFullYear() + 1 })]);
      expect(result.rows).toHaveLength(1);
    });

    it('rejects a year beyond next year', async () => {
      const result = await run([row({ manufactureYear: new Date().getFullYear() + 2 })]);
      expect(result.rejections).toHaveLength(1);
    });

    it('rejects a registration year preceding manufacture', async () => {
      // A vehicle cannot be registered before it was built — usually the two
      // columns have been swapped.
      const result = await run([row({ manufactureYear: 2015, registrationYear: 2012 })]);
      expect(result.rejections[0].reason).toMatch(/precedes manufacture/);
    });

    it.each([[0], [-1]])('rejects a price of %s', async (price) => {
      const result = await run([row({ price })]);
      expect(result.rejections[0].reason).toMatch(/greater than 0/);
    });

    it('rejects a price beyond numeric(14,2)', async () => {
      // Would raise at INSERT and, because Load batches, take every good row
      // travelling with it.
      const result = await run([row({ price: MAX_PRICE + 1 })]);
      expect(result.rejections[0].reason).toMatch(/exceeds/);
    });

    it('accepts zero mileage but rejects negative', async () => {
      expect((await run([row({ mileage: 0 })])).rows).toHaveLength(1);
      expect((await run([row({ mileage: -1 })])).rejections).toHaveLength(1);
    });

    it('rejects an implausible mileage', async () => {
      const result = await run([row({ mileage: MAX_MILEAGE + 1 })]);
      expect(result.rejections[0].reason).toMatch(/implausible/);
    });
  });

  describe('column widths', () => {
    it('rejects an over-long value rather than truncating it', async () => {
      // Truncating would silently corrupt a chassis number or a plate.
      const result = await run([row({ chassisNumber: 'X'.repeat(101) })]);

      expect(result.rejections[0].reason).toMatch(/chassis_number exceeds 100/);
    });

    it('accepts a value exactly at the limit', async () => {
      const result = await run([row({ chassisNumber: 'X'.repeat(100) })]);
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('intra-job duplicate registration', () => {
    it('rejects the second row claiming a registration number', async () => {
      // Both rows would upsert over each other under
      // idx_vehicles_job_registration: the second silently overwrites the
      // first, with no error and no rejected record. The dealer sees
      // "1 loaded" for 2 rows and never learns which vanished.
      const result = await run([
        row({ registrationNumber: 'CAB-1234' }, { rowNumber: 1 }),
        row({ registrationNumber: 'CAB-1234' }, { rowNumber: 2 }),
      ]);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].rowNumber).toBe(1);
      expect(result.rejections[0].rowNumber).toBe(2);
    });

    it('names the row that won, so the dealer can compare them', async () => {
      const result = await run([
        row({ registrationNumber: 'CAB-1234' }, { rowNumber: 7 }),
        row({ registrationNumber: 'CAB-1234' }, { rowNumber: 12 }),
      ]);

      expect(result.rejections[0].reason).toMatch(/also on row 7/);
    });

    it('allows many rows without a registration number', async () => {
      // Unregistered imports are legitimate stock and routinely arrive in
      // batches. They miss the partial index entirely.
      const result = await run([row({}, { rowNumber: 1 }), row({}, { rowNumber: 2 })]);

      expect(result.rows).toHaveLength(2);
    });

    it('does not let a rejected row shadow a later good one', async () => {
      // Row 1 is invalid for another reason, so it never loads and cannot own
      // the number. Row 2 must still be allowed to claim it.
      const result = await run([
        row({ registrationNumber: 'CAB-1234', price: -1 }, { rowNumber: 1 }),
        row({ registrationNumber: 'CAB-1234' }, { rowNumber: 2 }),
      ]);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].rowNumber).toBe(2);
      expect(result.rejections[0].reason).not.toMatch(/duplicate/);
    });
  });

  it('does not reject a row for an absent vehicleType or condition', async () => {
    // Both are required columns but supplied by derivation and defaulting —
    // enrich fills them. Reporting them as missing cells would blame the
    // dealer for a column the contract does not require.
    const result = await run([without('vehicleType'), without('condition')]);

    expect(result.rows).toHaveLength(2);
  });

  it('carries the raw cells into the rejection for the dealer report', async () => {
    const raw = { make: 'Lamborghini', price: 'call me' };
    const result = await run([without('make', { raw })]);

    expect(result.rejections[0].rawData).toEqual(raw);
  });

  it('clamps an over-long reason to the column width', async () => {
    // ingestion.rejected_records.reason is varchar(500); an over-long reason
    // throws at INSERT and takes the whole chunk's rejections with it.
    const result = await run([
      row({ chassisNumber: 'X'.repeat(101), color: 'Y'.repeat(51) }, { raw: {} }),
    ]);

    expect(result.rejections[0].reason.length).toBeLessThanOrEqual(500);
  });

  it('is registered as the VALIDATE_ROWS stage', () => {
    expect(validateRowsStage.stage).toBe('VALIDATE_ROWS');
  });
});
