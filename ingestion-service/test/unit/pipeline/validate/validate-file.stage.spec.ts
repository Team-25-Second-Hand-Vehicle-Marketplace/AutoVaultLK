import { Readable } from 'node:stream';
import {
  FileValidationError,
  validateFileStage,
} from '../../../../src/workers/etl-worker/pipeline/validate/validate-file.stage';
import type { StageContext } from '../../../../src/workers/etl-worker/pipeline/types';

const HEADER = 'registration_number,make,model,year,price,mileage';

/**
 * Minimal StageContext. Only `store` is reached by this stage, so the rest is
 * cast rather than stubbed — a stage touching anything else would be a contract
 * violation worth failing on.
 */
const contextFor = (content: Buffer | string, exists = true): StageContext =>
  ({
    jobId: 'job-1',
    dealerId: 'dealer-1',
    chunkId: null,
    store: {
      exists: jest.fn().mockResolvedValue(exists),
      getStream: jest.fn().mockResolvedValue(Readable.from([Buffer.from(content as never)])),
    },
  }) as never;

const run = (content: Buffer | string, fileName = 'stock.csv', exists = true) =>
  validateFileStage.run(contextFor(content, exists), { key: `raw/job-1/${fileName}`, fileName });

describe('validateFileStage', () => {
  it('accepts a well-formed file and returns canonical headers', async () => {
    const result = await run(`${HEADER}\nCAB-1234,Toyota,Vitz,2015,3500000,45000\n`);

    expect(result.headers).toEqual([
      'registration_number',
      'make',
      'model',
      'year',
      'price',
      'mileage',
    ]);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('folds header aliases, casing and spacing to canonical names', async () => {
    const result = await run('Manufacturer, Variant ,YOM,Asking Price,Odometer\n');

    expect(result.headers).toEqual(['make', 'model', 'year', 'price', 'mileage']);
  });

  it('strips the UTF-8 BOM Excel writes before the first header', async () => {
    // Without the strip this reads as a column named "﻿make", and the file is
    // rejected for a missing `make` column that is plainly present on screen.
    const result = await run(`﻿${HEADER}\n`);

    expect(result.headers[1]).toBe('make');
  });

  it('names every missing required column at once', async () => {
    // One message listing all of them: a dealer fixing columns one upload at a
    // time is the failure mode this avoids.
    await expect(run('make,model\n')).rejects.toThrow(/year, price, mileage/);
  });

  it('rejects a non-csv extension', async () => {
    await expect(run(`${HEADER}\n`, 'stock.xlsx')).rejects.toThrow(FileValidationError);
  });

  it('rejects an empty file', async () => {
    await expect(run('')).rejects.toThrow(/empty/i);
  });

  it('rejects a file missing from storage', async () => {
    await expect(run(`${HEADER}\n`, 'stock.csv', false)).rejects.toThrow(/could not be read/i);
  });

  it('rejects a file that is not valid UTF-8', async () => {
    // 0xFF 0xFE is a UTF-16 BOM — a "Save as Unicode" in Excel. Decoding it
    // leniently would yield replacement characters and fail later as a
    // dictionary miss on every single row.
    await expect(run(Buffer.from([0xff, 0xfe, 0x41, 0x00]))).rejects.toThrow(/UTF-8/);
  });

  it('rejects duplicate columns rather than silently dropping one', async () => {
    // `make` and `Manufacturer` both fold to `make`; choosing either would
    // discard a whole column's data for every row.
    await expect(run('make,Manufacturer,model,year,price,mileage\n')).rejects.toThrow(
      /Duplicate columns: make/,
    );
  });

  it('keeps a quoted comma inside a header cell', async () => {
    const result = await run('"model, trim",make,model,year,price,mileage\n');

    // The quoted cell stays one column: splitting on the raw comma would shift
    // every subsequent header by one and mis-key the entire file.
    expect(result.headers).toEqual([
      'model_trim',
      'make',
      'model',
      'year',
      'price',
      'mileage',
    ]);
  });

  it('rejects a file with no row separator in the header window', async () => {
    // Stands in for an XLSX saved with a .csv extension: binary, no newline.
    await expect(run('x'.repeat(64 * 1024 + 10))).rejects.toThrow(/no row separator/i);
  });

  it('is registered as the VALIDATE_FILE stage', () => {
    expect(validateFileStage.stage).toBe('VALIDATE_FILE');
  });
});
