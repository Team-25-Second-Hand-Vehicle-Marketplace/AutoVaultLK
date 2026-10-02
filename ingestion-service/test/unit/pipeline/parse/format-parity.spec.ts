jest.mock('unzipper', () => ({ Open: { buffer: jest.fn() } }));

import { Readable } from 'node:stream';
import { splitChunksStage } from '../../../../src/workers/etl-worker/pipeline/parse/split-chunks.stage';
import { validateFileStage } from '../../../../src/workers/etl-worker/pipeline/validate/validate-file.stage';
import { REQUIRED_COLUMNS } from '../../../../src/workers/etl-worker/pipeline/parse/csv-contract';
import type {
  RawRow,
  StageContext,
} from '../../../../src/workers/etl-worker/pipeline/types';

/**
 * The promise JSON support makes: the same inventory, uploaded in either
 * format, enters the pipeline as identical rows. These tests state that
 * directly rather than relying on two independent suites happening to agree.
 */

const COLUMNS = [...REQUIRED_COLUMNS, 'registration_number'] as const;

const VEHICLES = [
  {
    registration_number: 'CAB-1',
    make: 'Toyota',
    model: 'Aqua',
    year: '2018',
    price: '6500000',
    mileage: '45000',
    fuel_type: 'HYBRID',
    transmission: 'AUTOMATIC',
    color: 'White',
    engine_capacity_cc: '1500',
    owners_count: '1',
    location_district: 'Colombo',
    condition: 'USED',
    vehicle_type: 'CAR',
  },
  {
    registration_number: 'CAB-2',
    make: 'Honda',
    model: 'Vezel',
    year: '2020',
    price: '11200000',
    mileage: '12000',
    fuel_type: 'PETROL',
    transmission: 'CVT',
    color: 'Black',
    engine_capacity_cc: '1500',
    owners_count: '2',
    location_district: 'Kandy',
    condition: 'RECONDITIONED',
    vehicle_type: 'SUV',
  },
  {
    registration_number: '',
    make: 'Suzuki',
    model: 'Alto',
    year: '2014',
    price: '2100000',
    mileage: '60000',
    fuel_type: 'PETROL',
    transmission: 'MANUAL',
    color: 'Silver',
    engine_capacity_cc: '800',
    owners_count: '3',
    location_district: 'Galle',
    condition: 'USED',
    vehicle_type: 'CAR',
  },
];

const asCsv = (): string =>
  [
    COLUMNS.join(','),
    ...VEHICLES.map((v) => COLUMNS.map((c) => v[c]).join(',')),
  ].join('\n') + '\n';

/** JSON keeps real types - numbers, not strings - the way a DMS export would. */
const asJson = (): string =>
  JSON.stringify(
    VEHICLES.map((v) => ({
      ...v,
      year: Number(v.year),
      price: Number(v.price),
      mileage: Number(v.mileage),
      engine_capacity_cc: Number(v.engine_capacity_cc),
      owners_count: Number(v.owners_count),
      registration_number:
        v.registration_number === '' ? null : v.registration_number,
    })),
  );

type Harness = { ctx: StageContext; written: Map<string, string> };

const harness = (content: string, chunkSize = 2): Harness => {
  const written = new Map<string, string>();
  return {
    written,
    ctx: {
      jobId: 'job-1',
      dealerId: 'dealer-1',
      chunkId: null,
      config: { chunkSize },
      store: {
        exists: jest.fn().mockResolvedValue(true),
        getStream: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve(Readable.from([Buffer.from(content)])),
          ),
        put: jest.fn((key: string, body: string) => {
          written.set(key, body);
          return Promise.resolve(key);
        }),
      },
    } as never,
  };
};

const chunksOf = (written: Map<string, string>): RawRow[][] =>
  [...written.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, body]) => JSON.parse(body) as RawRow[]);

describe('CSV / JSON parity', () => {
  it('writes identical chunks for the same inventory', async () => {
    const csv = harness(asCsv());
    const json = harness(asJson());

    const csvResult = await splitChunksStage.run(csv.ctx, {
      key: 'raw/job-1/stock.csv',
      format: 'csv',
      headers: [],
    });
    const jsonResult = await splitChunksStage.run(json.ctx, {
      key: 'raw/job-1/stock.json',
      format: 'json',
      headers: [],
    });

    expect(jsonResult.totalRecords).toBe(csvResult.totalRecords);
    expect(jsonResult.chunkKeys).toEqual(csvResult.chunkKeys);
    expect(chunksOf(json.written)).toEqual(chunksOf(csv.written));
  });

  it('reports the same canonical columns for the same inventory', async () => {
    const csv = await validateFileStage.run(harness(asCsv()).ctx, {
      key: 'raw/job-1/stock.csv',
      fileName: 'stock.csv',
      format: 'csv',
    });
    const json = await validateFileStage.run(harness(asJson()).ctx, {
      key: 'raw/job-1/stock.json',
      fileName: 'stock.json',
      format: 'json',
    });

    expect([...json.headers].sort()).toEqual([...csv.headers].sort());
    expect(json.format).toBe('json');
    expect(csv.format).toBe('csv');
  });

  it('treats a null registration number in JSON like a blank CSV cell', async () => {
    const { ctx, written } = harness(asJson(), 10);
    await splitChunksStage.run(ctx, {
      key: 'raw/job-1/stock.json',
      format: 'json',
      headers: [],
    });

    const [rows] = chunksOf(written);
    expect(rows[2].raw.registration_number).toBe('');
  });
});

describe('splitChunksStage - JSON', () => {
  it('numbers records from 1, matching the position in the array', async () => {
    const { ctx, written } = harness(asJson(), 10);
    await splitChunksStage.run(ctx, {
      key: 'raw/job-1/stock.json',
      format: 'json',
      headers: [],
    });

    const [rows] = chunksOf(written);
    expect(rows.map((r) => r.rowNumber)).toEqual([1, 2, 3]);
  });

  it('skips a record with no values, as CSV skips a blank line', async () => {
    const { ctx, written } = harness(
      JSON.stringify([
        { make: 'Toyota' },
        { make: '', model: null },
        {},
        { make: 'Honda' },
      ]),
      10,
    );

    const result = await splitChunksStage.run(ctx, {
      key: 'raw/job-1/stock.json',
      format: 'json',
      headers: [],
    });

    expect(result.totalRecords).toBe(2);
    // rowNumber still counts the skipped records, so a rejection points at the
    // position the dealer sees in their own file.
    expect(chunksOf(written)[0].map((r) => r.rowNumber)).toEqual([1, 4]);
  });

  it('fails the job on a nested value rather than writing a mangled row', async () => {
    const { ctx } = harness(
      JSON.stringify([{ make: 'Toyota', specs: { a: 1 } }]),
    );

    await expect(
      splitChunksStage.run(ctx, {
        key: 'raw/job-1/stock.json',
        format: 'json',
        headers: [],
      }),
    ).rejects.toThrow(/"specs" must be a single value/);
  });
});

describe('validateFileStage - JSON', () => {
  const run = (content: string | Buffer, fileName = 'stock.json') =>
    validateFileStage.run(harness(content as string).ctx, {
      key: `raw/job-1/${fileName}`,
      fileName,
      format: 'json',
    });

  const completeRecord = (): Record<string, unknown> => ({
    make: 'Toyota',
    model: 'Aqua',
    year: 2018,
    price: 6500000,
    mileage: 45000,
    fuel_type: 'HYBRID',
    transmission: 'AUTOMATIC',
    color: 'White',
    engine_capacity_cc: 1500,
    owners_count: 1,
    location_district: 'Colombo',
    condition: 'USED',
    vehicle_type: 'CAR',
  });

  it('accepts a complete file', async () => {
    const result = await run(JSON.stringify([completeRecord()]));

    expect(result.format).toBe('json');
    expect(result.headers).toEqual(
      expect.arrayContaining([...REQUIRED_COLUMNS]),
    );
  });

  it('accepts a file whose records each carry only some optional columns', async () => {
    const result = await run(
      JSON.stringify([
        completeRecord(),
        { ...completeRecord(), sunroof: true },
        completeRecord(),
      ]),
    );

    expect(result.headers).toContain('sunroof');
  });

  it('passes a required column that is present in only one record', async () => {
    // JSON has no header row, so "the column exists" means "some record has
    // it". A record missing it is a per-row matter for validateRows.
    const { color, ...withoutColor } = completeRecord();
    void color;

    const result = await run(JSON.stringify([withoutColor, completeRecord()]));

    expect(result.headers).toContain('color');
  });

  it('fails a required column that no record has, naming it', async () => {
    const { vehicle_type, ...withoutType } = completeRecord();
    void vehicle_type;

    await expect(
      run(JSON.stringify([withoutType, withoutType])),
    ).rejects.toThrow(/Missing required columns: vehicle_type/);
  });

  it('accepts dealer spellings of the required columns', async () => {
    const { make, year, ...rest } = completeRecord();
    void make;
    void year;

    const result = await run(
      JSON.stringify([{ ...rest, Manufacturer: 'Toyota', YOM: 2018 }]),
    );

    expect(result.headers).toEqual(expect.arrayContaining(['make', 'year']));
  });

  it('rejects a .csv name when the job is JSON, pointing at the right extension', async () => {
    await expect(
      run(JSON.stringify([completeRecord()]), 'stock.csv'),
    ).rejects.toThrow(/Unsupported file type "\.csv"\. Upload a \.json file\./);
  });

  it('rejects an empty array', async () => {
    await expect(run('[]')).rejects.toThrow(/no records/i);
  });

  it('rejects a file that is not valid UTF-8', async () => {
    await expect(
      run(
        Buffer.from([
          0x5b, 0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xe9, 0x22, 0x7d, 0x5d,
        ]),
      ),
    ).rejects.toThrow(/UTF-8/);
  });

  it('rejects a CSV body uploaded as JSON with a message about arrays', async () => {
    await expect(run(asCsv())).rejects.toThrow(/must be an array/i);
  });
});
