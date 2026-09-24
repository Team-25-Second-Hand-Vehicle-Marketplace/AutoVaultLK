jest.mock('unzipper', () => ({
  Open: {
    buffer: jest.fn(),
  },
}));

import { Readable } from 'node:stream';
import unzipper from 'unzipper';
import {
  FileValidationError,
  validateFileStage,
} from '../../../../src/workers/etl-worker/pipeline/validate/validate-file.stage';
import type { StageContext } from '../../../../src/workers/etl-worker/pipeline/types';

const HEADER =
  'registration_number,make,model,year,price,mileage,fuel_type,transmission,color,engine_capacity_cc,owners_count,location_district';

const zipEntry = (path: string, uncompressedSize = 1024) => ({
  type: 'File',
  path,
  uncompressedSize,
});

const mockZip = (files: unknown[]): void => {
  (unzipper.Open.buffer as jest.Mock).mockResolvedValue({ files });
};

/**
 * Minimal StageContext. Only `store` is reached by this stage, so the rest is
 * cast rather than stubbed — a stage touching anything else would be a contract
 * violation worth failing on.
 */
const contextFor = (
  content: Buffer | string,
  exists = true,
  zipBuffer: Buffer = Buffer.from('zip'),
): StageContext =>
  ({
    jobId: 'job-1',
    dealerId: 'dealer-1',
    chunkId: null,
    store: {
      exists: jest.fn().mockResolvedValue(exists),
      getStream: jest.fn().mockResolvedValue(Readable.from([Buffer.from(content as never)])),
      get: jest.fn().mockResolvedValue(zipBuffer),
    },
  }) as never;

const run = (content: Buffer | string, fileName = 'stock.csv', exists = true) =>
  validateFileStage.run(contextFor(content, exists), { key: `raw/job-1/${fileName}`, fileName });

const runWithZip = (
  content: Buffer | string,
  zipKey = 'raw/job-1/images.zip',
  exists = true,
) =>
  validateFileStage.run(contextFor(content, exists), {
    key: 'raw/job-1/stock.csv',
    fileName: 'stock.csv',
    zipKey,
  });

describe('validateFileStage', () => {
  it('accepts a well-formed file and returns canonical headers', async () => {
    const result = await run(
      `${HEADER}\nCAB-1234,Toyota,Vitz,2015,3500000,45000,PETROL,AUTOMATIC,White,1000,1,Colombo\n`,
    );

    expect(result.headers).toEqual([
      'registration_number',
      'make',
      'model',
      'year',
      'price',
      'mileage',
      'fuel_type',
      'transmission',
      'color',
      'engine_capacity_cc',
      'owners_count',
      'location_district',
    ]);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('folds header aliases, casing and spacing to canonical names', async () => {
    const result = await run(
      'Manufacturer, Variant ,YOM,Asking Price,Odometer,Fuel,Gear,Color,Engine,Owners,District\n',
    );

    expect(result.headers).toEqual([
      'make',
      'model',
      'year',
      'price',
      'mileage',
      'fuel_type',
      'transmission',
      'color',
      'engine_capacity_cc',
      'owners_count',
      'location_district',
    ]);
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
    await expect(run('make,model\n')).rejects.toThrow(
      /year, price, mileage, fuel_type, transmission, color, engine_capacity_cc, owners_count, location_district/,
    );
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
    await expect(run(`make,Manufacturer,${HEADER}\n`)).rejects.toThrow(/Duplicate columns: make/);
  });

  it('keeps a quoted comma inside a header cell', async () => {
    const result = await run(`"model, trim",${HEADER}\n`);

    // The quoted cell stays one column: splitting on the raw comma would shift
    // every subsequent header by one and mis-key the entire file.
    expect(result.headers[0]).toBe('model_trim');
    expect(result.headers).toEqual(['model_trim', ...HEADER.split(',')]);
  });

  it('rejects a file with no row separator in the header window', async () => {
    // Stands in for an XLSX saved with a .csv extension: binary, no newline.
    await expect(run('x'.repeat(64 * 1024 + 10))).rejects.toThrow(/no row separator/i);
  });

  it('is registered as the VALIDATE_FILE stage', () => {
    expect(validateFileStage.stage).toBe('VALIDATE_FILE');
  });

  describe('photo archive validation', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('accepts a well-formed archive of only images', async () => {
      mockZip([zipEntry('CAB-1234.jpg'), zipEntry('CAB-1234-2.jpg')]);

      await expect(runWithZip(`${HEADER}\nCAB-1234,Toyota,Vitz,2015,3500000,45000\n`)).resolves.toBeDefined();
    });

    it('is a no-op when the dealer uploaded no photo archive', async () => {
      // Legitimate — FR-35.2 covers rows with no automated image match.
      await expect(run(`${HEADER}\nCAB-1234,Toyota,Vitz,2015,3500000,45000\n`)).resolves.toBeDefined();
      expect(unzipper.Open.buffer).not.toHaveBeenCalled();
    });

    it('rejects a non-zip extension', async () => {
      await expect(
        runWithZip(`${HEADER}\n`, 'raw/job-1/images.rar'),
      ).rejects.toThrow(/Upload a \.zip file/);
    });

    it('rejects an archive missing from storage', async () => {
      const ctx: StageContext = {
        jobId: 'job-1',
        dealerId: 'dealer-1',
        chunkId: null,
        store: {
          exists: jest
            .fn()
            .mockImplementation((key: string) => Promise.resolve(!key.includes('missing'))),
          getStream: jest
            .fn()
            .mockResolvedValue(Readable.from([Buffer.from(`${HEADER}\n`)])),
          get: jest.fn().mockResolvedValue(Buffer.from('zip')),
        },
      } as never;

      await expect(
        validateFileStage.run(ctx, {
          key: 'raw/job-1/stock.csv',
          fileName: 'stock.csv',
          zipKey: 'raw/job-1/missing.zip',
        }),
      ).rejects.toThrow(/could not be read from storage/i);
    });

    it('rejects a corrupted archive that unzipper cannot open', async () => {
      (unzipper.Open.buffer as jest.Mock).mockRejectedValue(new Error('not a zip'));

      await expect(runWithZip(`${HEADER}\n`)).rejects.toThrow(/not a valid ZIP/i);
    });

    it('rejects an archive with more entries than the limit', async () => {
      const files = Array.from({ length: 2001 }, (_, i) => zipEntry(`CAB-${i}.jpg`));
      mockZip(files);

      await expect(runWithZip(`${HEADER}\n`)).rejects.toThrow(/exceeds the 2000 limit/);
    });

    it('rejects an archive with a path-traversal entry', async () => {
      mockZip([zipEntry('../../etc/passwd')]);

      await expect(runWithZip(`${HEADER}\n`)).rejects.toThrow(/unsafe path/i);
    });

    it('rejects an archive whose declared uncompressed size is implausible', async () => {
      mockZip([zipEntry('CAB-1234.jpg', 3 * 1024 * 1024 * 1024)]);

      await expect(runWithZip(`${HEADER}\n`)).rejects.toThrow(/decompresses to more data/i);
    });

    it('rejects an archive with no recognised image files', async () => {
      mockZip([zipEntry('readme.txt'), zipEntry('manifest.pdf')]);

      await expect(runWithZip(`${HEADER}\n`)).rejects.toThrow(/no recognised image files/i);
    });

    it('tolerates a stray non-image file alongside real photos', async () => {
      mockZip([zipEntry('CAB-1234.jpg'), zipEntry('Thumbs.db')]);

      await expect(runWithZip(`${HEADER}\n`)).resolves.toBeDefined();
    });
  });
});
