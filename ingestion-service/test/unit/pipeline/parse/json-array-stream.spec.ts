import { Readable } from 'node:stream';
import { iterateJsonArray } from '../../../../src/workers/etl-worker/pipeline/parse/json-array-stream';
import { FileValidationError } from '../../../../src/workers/etl-worker/pipeline/parse/file-validation-error';

const chunksOf = (parts: (Buffer | string)[]): AsyncIterable<Buffer | string> =>
  Readable.from(parts, { objectMode: true });

const collect = async (...parts: (Buffer | string)[]): Promise<unknown[]> => {
  const out: unknown[] = [];
  for await (const element of iterateJsonArray(chunksOf(parts))) {
    out.push(element);
  }
  return out;
};

describe('iterateJsonArray', () => {
  describe('well-formed input', () => {
    it('yields each element in order', async () => {
      await expect(
        collect('[{"make":"Toyota"},{"make":"Honda"},{"make":"Suzuki"}]'),
      ).resolves.toEqual([
        { make: 'Toyota' },
        { make: 'Honda' },
        { make: 'Suzuki' },
      ]);
    });

    it('yields nothing for an empty array - the reader owns "no records"', async () => {
      await expect(collect('[]')).resolves.toEqual([]);
      await expect(collect('  [ \n ]  ')).resolves.toEqual([]);
    });

    it('tolerates whitespace and newlines between elements', async () => {
      await expect(
        collect('\n[\n  { "a": 1 } ,\r\n\t{ "a": 2 }\n]\n'),
      ).resolves.toEqual([{ a: 1 }, { a: 2 }]);
    });

    it('skips a UTF-8 byte-order mark', async () => {
      await expect(
        collect(
          Buffer.concat([
            Buffer.from([0xef, 0xbb, 0xbf]),
            Buffer.from('[{"a":1}]'),
          ]),
        ),
      ).resolves.toEqual([{ a: 1 }]);
    });

    it('is not fooled by brackets, braces, commas and quotes inside strings', async () => {
      const element = {
        description: 'a ] b } c , d [ e { f \\" g \\\\ "',
        note: '"]"',
      };
      const text = JSON.stringify([element, { x: 1 }]);

      await expect(collect(text)).resolves.toEqual([element, { x: 1 }]);
    });

    it('handles nested objects and arrays inside an element', async () => {
      await expect(
        collect('[{"a":{"b":[1,2,{"c":[]}]},"d":[[],[{}]]},{"e":1}]'),
      ).resolves.toEqual([
        { a: { b: [1, 2, { c: [] }] }, d: [[], [{}]] },
        { e: 1 },
      ]);
    });

    it('yields bare primitives so the reader can reject them by name', async () => {
      await expect(
        collect('[1, "two", true, null, {"a":1}, 2.5e3]'),
      ).resolves.toEqual([1, 'two', true, null, { a: 1 }, 2500]);
    });

    it('decodes multi-byte characters', async () => {
      await expect(
        collect('[{"city":"කොළඹ","note":"café – ✓"}]'),
      ).resolves.toEqual([{ city: 'කොළඹ', note: 'café – ✓' }]);
    });
  });

  describe('chunk boundaries', () => {
    // A network stream splits wherever it likes: mid-string, mid-escape, even
    // mid-way through a multi-byte character. Splitting at every byte offset
    // proves the result never depends on where the cuts fall.
    const document = JSON.stringify([
      {
        make: 'Toyota',
        description: 'quote " bracket ] brace } slash \\ end',
        city: 'කොළඹ',
      },
      {
        make: 'Honda',
        year: 2020,
        flag: true,
        none: null,
        nested: { a: [1, 2] },
      },
      { make: 'Suzuki' },
    ]);
    const bytes = Buffer.from(document, 'utf8');
    const expected = JSON.parse(document) as unknown[];

    it('gives the same result when split at every byte offset', async () => {
      for (let i = 0; i <= bytes.length; i++) {
        const result = await collect(bytes.subarray(0, i), bytes.subarray(i));
        expect(result).toEqual(expected);
      }
    });

    it('gives the same result fed one byte at a time', async () => {
      const singles = Array.from(bytes, (_b, i) => bytes.subarray(i, i + 1));
      await expect(collect(...singles)).resolves.toEqual(expected);
    });

    it('accepts string chunks as well as buffers', async () => {
      await expect(collect('[{"a":', '1},{"a"', ':2}]')).resolves.toEqual([
        { a: 1 },
        { a: 2 },
      ]);
    });
  });

  describe('structural defects', () => {
    const fails = async (message: RegExp, ...parts: (Buffer | string)[]) => {
      const error = await collect(...parts).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FileValidationError);
      expect((error as Error).message).toMatch(message);
    };

    it('rejects an empty file', async () => {
      await fails(/empty/i, '');
      await fails(/empty/i, '   \n ');
    });

    it('rejects a root that is not an array', async () => {
      await fails(/must be an array/i, '{"make":"Toyota"}');
      await fails(/must be an array/i, '"text"');
      await fails(/must be an array/i, 'make,model\nToyota,Vitz');
    });

    it('rejects an array that is never closed', async () => {
      await fails(/never closed/i, '[{"a":1},{"a":2}');
      await fails(/never closed/i, '[');
      await fails(/never closed/i, '[1');
    });

    it('rejects a record cut off mid-way', async () => {
      await fails(/never closed/i, '[{"a":1},{"a":');
    });

    it('rejects a trailing comma, naming the record before it', async () => {
      await fails(/trailing comma.*record 2/i, '[{"a":1},{"a":2},]');
    });

    it('rejects a leading or doubled comma', async () => {
      await fails(/unexpected comma/i, '[,{"a":1}]');
      await fails(/unexpected comma.*record 1/i, '[{"a":1},,{"a":2}]');
    });

    it('rejects two records with no comma between them', async () => {
      await fails(/expected a comma.*record 1/i, '[{"a":1} {"a":2}]');
    });

    it('rejects content after the closing bracket', async () => {
      await fails(/after the closing/i, '[{"a":1}] [{"a":2}]');
      await fails(/after the closing/i, '[{"a":1}] x');
    });

    it('rejects a record that is not valid JSON, naming it', async () => {
      await fails(/record 2 is not valid JSON/i, '[{"a":1},{"a":}]');
      await fails(/record 1 is not valid JSON/i, "[{'a':1}]");
    });

    it('rejects a stray closing brace after a primitive', async () => {
      await fails(/unexpected \}/i, '[1}');
    });

    it('rejects bytes that are not valid UTF-8 instead of decoding them to U+FFFD', async () => {
      await fails(/UTF-8/i, Buffer.from([0x5b, 0x22, 0xff, 0xfe, 0x22, 0x5d]));
    });

    it('rejects a multi-byte character cut off at the end of the file', async () => {
      const whole = Buffer.from('[{"a":"é"}]');
      const truncated = whole.subarray(0, whole.indexOf(0xc3) + 1);
      await fails(/UTF-8/i, truncated);
    });
  });
});
