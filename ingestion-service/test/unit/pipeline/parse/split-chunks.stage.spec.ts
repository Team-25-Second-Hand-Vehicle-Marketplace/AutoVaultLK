import { Readable } from 'node:stream';
import {
  chunkKey,
  splitChunksStage,
} from '../../../../src/workers/etl-worker/pipeline/parse/split-chunks.stage';
import type {
  RawRow,
  StageContext,
} from '../../../../src/workers/etl-worker/pipeline/types';

const HEADER = 'registration_number,make,model,year,price,mileage';

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
        getStream: jest.fn().mockResolvedValue(Readable.from([Buffer.from(content)])),
        put: jest.fn(async (key: string, body: string) => {
          written.set(key, body);
          return key;
        }),
      },
    } as never,
  };
};

const rowsIn = (written: Map<string, string>, key: string): RawRow[] =>
  JSON.parse(written.get(key) as string) as RawRow[];

const csv = (...lines: string[]) => `${HEADER}\n${lines.join('\n')}\n`;

describe('splitChunksStage', () => {
  it('writes fixed-size chunks and reports the row total', async () => {
    const { ctx, written } = harness(
      csv(
        'CAB-1,Toyota,Vitz,2015,3500000,45000',
        'CAB-2,Honda,Fit,2016,4200000,38000',
        'CAB-3,Suzuki,Alto,2014,2100000,60000',
      ),
      2,
    );

    const result = await splitChunksStage.run(ctx, { key: 'raw/job-1/stock.csv', headers: [] });

    expect(result.totalRecords).toBe(3);
    expect(result.chunkKeys).toEqual([
      'staging/job-1/chunk-000.json',
      'staging/job-1/chunk-001.json',
    ]);
    expect(rowsIn(written, result.chunkKeys[0])).toHaveLength(2);
    expect(rowsIn(written, result.chunkKeys[1])).toHaveLength(1);
  });

  it('numbers rows from 1, excluding the header', async () => {
    // rowNumber is what the dealer sees in the rejected-rows table, so it must
    // line up with the line they see in Excel minus the header.
    const { ctx, written } = harness(
      csv('CAB-1,Toyota,Vitz,2015,3500000,45000', 'CAB-2,Honda,Fit,2016,4200000,38000'),
      10,
    );

    const result = await splitChunksStage.run(ctx, { key: 'raw/job-1/stock.csv', headers: [] });

    expect(rowsIn(written, result.chunkKeys[0]).map((r) => r.rowNumber)).toEqual([1, 2]);
  });

  it('carries every value as a string for parseNormalize to coerce', async () => {
    // Coercion belongs downstream, where a bad number can become a rejection
    // with a reason instead of a silent NaN.
    const { ctx, written } = harness(csv('CAB-1,Toyota,Vitz,2015,3500000,45000'), 10);

    const result = await splitChunksStage.run(ctx, { key: 'raw/job-1/stock.csv', headers: [] });

    expect(rowsIn(written, result.chunkKeys[0])[0].raw).toEqual({
      registration_number: 'CAB-1',
      make: 'Toyota',
      model: 'Vitz',
      year: '2015',
      price: '3500000',
      mileage: '45000',
    });
  });

  it('skips fully blank rows without counting them', async () => {
    // Trailing empty rows are spreadsheet noise; surfacing them as rejections
    // would bury the dealer's real errors.
    const { ctx } = harness(csv('CAB-1,Toyota,Vitz,2015,3500000,45000', ',,,,,', ',,,,,'), 10);

    const result = await splitChunksStage.run(ctx, { key: 'raw/job-1/stock.csv', headers: [] });

    expect(result.totalRecords).toBe(1);
  });

  it('keeps a short row instead of aborting the file', async () => {
    // relaxColumnCount: one ragged line is a row defect. Without it csv-parse
    // throws and the dealer loses every valid row in the upload.
    const { ctx, written } = harness(csv('CAB-1,Toyota,Vitz', 'CAB-2,Honda,Fit,2016,4200000,38000'), 10);

    const result = await splitChunksStage.run(ctx, { key: 'raw/job-1/stock.csv', headers: [] });

    expect(result.totalRecords).toBe(2);
    // csv-parse omits the key rather than emitting an empty cell. Both read as
    // absent to parseNormalize, which rejects the row for a missing year.
    expect(rowsIn(written, result.chunkKeys[0])[0].raw.year).toBeUndefined();
    expect(rowsIn(written, result.chunkKeys[0])[1].raw.year).toBe('2016');
  });

  it('drops surplus cells from a long row rather than keying them undefined', async () => {
    const { ctx, written } = harness(csv('CAB-1,Toyota,Vitz,2015,3500000,45000,extra'), 10);

    const result = await splitChunksStage.run(ctx, { key: 'raw/job-1/stock.csv', headers: [] });
    const raw = rowsIn(written, result.chunkKeys[0])[0].raw;

    expect(raw).not.toHaveProperty('undefined');
    expect(Object.keys(raw)).toHaveLength(6);
  });

  it('folds header aliases the same way validateFile does', async () => {
    const { ctx, written } = harness('Manufacturer,Variant,YOM,Asking Price,Odometer\nToyota,Vitz,2015,3500000,45000\n', 10);

    const result = await splitChunksStage.run(ctx, { key: 'raw/job-1/stock.csv', headers: [] });

    expect(Object.keys(rowsIn(written, result.chunkKeys[0])[0].raw)).toEqual([
      'make',
      'model',
      'year',
      'price',
      'mileage',
    ]);
  });

  it('writes no chunk for a header-only file', async () => {
    const { ctx } = harness(`${HEADER}\n`, 10);

    const result = await splitChunksStage.run(ctx, { key: 'raw/job-1/stock.csv', headers: [] });

    expect(result).toEqual({ chunkKeys: [], totalRecords: 0 });
  });

  it('pads chunk indexes so keys sort in row order', () => {
    // ObjectStore.list sorts lexicographically; unpadded, chunk-10 precedes
    // chunk-2 and a retry would replay chunks out of order.
    expect([chunkKey('j', 10), chunkKey('j', 2)].sort()).toEqual([
      chunkKey('j', 2),
      chunkKey('j', 10),
    ]);
  });

  it('is registered as the SPLIT_CHUNKS stage', () => {
    expect(splitChunksStage.stage).toBe('SPLIT_CHUNKS');
  });
});
