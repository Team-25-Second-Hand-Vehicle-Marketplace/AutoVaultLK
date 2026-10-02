import { Readable } from 'node:stream';
import {
  flatten,
  jsonReader,
} from '../../../../src/workers/etl-worker/pipeline/parse/json-reader';
import { FileValidationError } from '../../../../src/workers/etl-worker/pipeline/parse/file-validation-error';
import type { StageContext } from '../../../../src/workers/etl-worker/pipeline/types';

const contextFor = (content: Buffer | string): StageContext =>
  ({
    jobId: 'job-1',
    dealerId: 'dealer-1',
    chunkId: null,
    store: {
      getStream: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(Readable.from([Buffer.from(content as never)])),
        ),
    },
  }) as never;

const rowsOf = async (content: string): Promise<Record<string, string>[]> => {
  const out: Record<string, string>[] = [];
  for await (const row of jsonReader.rows(
    contextFor(content),
    'raw/job-1/stock.json',
  )) {
    out.push(row);
  }
  return out;
};

describe('flatten', () => {
  it('turns every scalar into the string the pipeline expects', () => {
    expect(
      flatten(
        {
          make: 'Toyota',
          year: 2018,
          price: 6500000,
          mileage: 45000.5,
          sunroof: true,
          abs: false,
        },
        1,
      ),
    ).toEqual({
      make: 'Toyota',
      year: '2018',
      price: '6500000',
      mileage: '45000.5',
      sunroof: 'true',
      abs: 'false',
    });
  });

  it('reads null and an absent value as a blank cell', () => {
    expect(
      flatten({ make: 'Toyota', color: null, description: undefined }, 1),
    ).toEqual({
      make: 'Toyota',
      color: '',
      description: '',
    });
  });

  it('trims strings, as the CSV parser does', () => {
    expect(flatten({ make: '  Toyota  ', model: ' Aqua' }, 1)).toEqual({
      make: 'Toyota',
      model: 'Aqua',
    });
  });

  it('folds key casing, spacing and aliases to canonical column names', () => {
    expect(
      flatten(
        {
          Manufacturer: 'Toyota',
          ' Variant ': 'Aqua',
          YOM: 2018,
          'Asking Price': 6500000,
        },
        1,
      ),
    ).toEqual({
      make: 'Toyota',
      model: 'Aqua',
      year: '2018',
      price: '6500000',
    });
  });

  it('drops a key that folds to nothing, as the CSV reader drops an empty header', () => {
    expect(flatten({ make: 'Toyota', '###': 'noise', '': 'blank' }, 1)).toEqual(
      { make: 'Toyota' },
    );
  });

  it('keeps an empty-string value rather than dropping the column', () => {
    expect(flatten({ make: '' }, 1)).toEqual({ make: '' });
  });

  describe('rejections', () => {
    const rejected = (value: unknown, recordNumber = 1): Error => {
      try {
        flatten(value, recordNumber);
      } catch (error) {
        return error as Error;
      }
      throw new Error('expected flatten to throw');
    };

    it('rejects a nested object, naming the record and the field', () => {
      const error = rejected({ make: 'Toyota', specs: { sunroof: true } }, 7);

      expect(error).toBeInstanceOf(FileValidationError);
      expect(error.message).toMatch(/Record 7/);
      expect(error.message).toMatch(
        /"specs" must be a single value, not an object/,
      );
    });

    it('rejects an array value', () => {
      expect(rejected({ features: ['sunroof', 'abs'] }).message).toMatch(
        /"features" must be a single value, not an array/,
      );
    });

    it('rejects two keys that fold to the same column, naming both', () => {
      const error = rejected({ make: 'Toyota', Manufacturer: 'Honda' }, 3);

      expect(error).toBeInstanceOf(FileValidationError);
      expect(error.message).toMatch(/Record 3/);
      expect(error.message).toMatch(/"make" and "Manufacturer"/);
      expect(error.message).toMatch(/\(make\)/);
    });

    it('rejects an element that is not an object', () => {
      for (const element of [1, 'text', true, null, [1, 2]]) {
        const error = rejected(element, 4);
        expect(error).toBeInstanceOf(FileValidationError);
        expect(error.message).toMatch(/Record 4 is not an object/);
      }
    });
  });
});

describe('jsonReader.inspect', () => {
  const inspect = (content: Buffer | string) =>
    jsonReader.inspect(contextFor(content), 'raw/job-1/stock.json');

  it('reports the union of keys across records, in first-seen order', async () => {
    const result = await inspect(
      JSON.stringify([
        { make: 'Toyota', model: 'Aqua' },
        { make: 'Honda', year: 2020 },
        { model: 'Fit', color: 'Red', make: 'Honda' },
      ]),
    );

    expect(result.headers).toEqual(['make', 'model', 'year', 'color']);
  });

  it('reports canonical names, not the dealer spellings', async () => {
    const result = await inspect(
      JSON.stringify([{ Manufacturer: 'Toyota', 'Asking Price': 1 }]),
    );

    expect(result.headers).toEqual(['make', 'price']);
  });

  it('counts the bytes it read', async () => {
    const content = JSON.stringify([{ make: 'Toyota' }]);

    expect((await inspect(content)).byteLength).toBe(
      Buffer.byteLength(content),
    );
  });

  it('fails an empty array with a message about records, not columns', async () => {
    await expect(inspect('[]')).rejects.toThrow(/no records/i);
  });

  it('fails on a nested value anywhere in the file, not just the first record', async () => {
    const content = JSON.stringify([
      { make: 'Toyota' },
      { make: 'Honda' },
      { make: 'Fit', specs: {} },
    ]);

    await expect(inspect(content)).rejects.toThrow(/Record 3.*"specs"/);
  });

  it('propagates structural errors from the parser', async () => {
    await expect(inspect('{"make":"Toyota"}')).rejects.toThrow(
      /must be an array/i,
    );
    await expect(inspect('[{"make":"Toyota"}')).rejects.toThrow(
      /never closed/i,
    );
  });
});

describe('jsonReader.rows', () => {
  it('yields one string record per element', async () => {
    await expect(
      rowsOf(
        JSON.stringify([
          { make: 'Toyota', year: 2018 },
          { make: 'Honda', year: 2020 },
        ]),
      ),
    ).resolves.toEqual([
      { make: 'Toyota', year: '2018' },
      { make: 'Honda', year: '2020' },
    ]);
  });

  it('numbers nothing itself - row numbering belongs to splitChunks', async () => {
    const rows = await rowsOf('[{"make":"a"},{"make":"b"}]');

    expect(rows).toHaveLength(2);
  });
});
