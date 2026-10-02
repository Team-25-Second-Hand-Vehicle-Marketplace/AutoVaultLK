import { normalizeHeader } from './csv-contract';
import { FileValidationError } from './file-validation-error';
import type { FormatReader, InspectedFile } from './file-format';
import { iterateJsonArray } from './json-array-stream';
import type { StageContext } from '../types';

/**
 * The JSON reader. A file is a top-level array of flat objects, one per
 * vehicle, using the same column names as the CSV contract:
 *
 *   [{ "make": "Toyota", "model": "Aqua", "year": 2018, "price": 6500000 }]
 *
 * "Flat" is a deliberate rule, not a limitation to be worked around. The CSV
 * contract, the dealer template, KNOWN_COLUMNS and the category gating in
 * enrich are all defined over flat columns; accepting nested objects would
 * need a second contract and a set of guesses about where `specs.axle_count`
 * belongs. One flat shape keeps both formats meaning exactly the same thing.
 *
 * Unlike CSV there is no header row, so the column set is the union of keys
 * across every record. That means inspect has to read the whole file - once,
 * streamed - where the CSV reader needs only its first line.
 */
export const jsonReader: FormatReader = {
  extension: '.json',

  async inspect(ctx: StageContext, key: string): Promise<InspectedFile> {
    const headers: string[] = [];
    const seen = new Set<string>();
    let records = 0;
    let byteLength = 0;

    const counted = countBytes(await ctx.store.getStream(key), (n) => {
      byteLength += n;
    });

    for await (const element of iterateJsonArray(counted)) {
      records++;
      const row = flatten(element, records);

      for (const column of Object.keys(row)) {
        if (seen.has(column)) continue;
        seen.add(column);
        headers.push(column);
      }
    }

    if (records === 0) {
      throw new FileValidationError('File has no records.');
    }

    return { headers, byteLength };
  },

  async *rows(
    ctx: StageContext,
    key: string,
  ): AsyncIterable<Record<string, string>> {
    const stream = await ctx.store.getStream(key);
    let record = 0;

    for await (const element of iterateJsonArray(
      stream as AsyncIterable<Buffer | string>,
    )) {
      record++;
      yield flatten(element, record);
    }
  },
};

/**
 * Turns one JSON element into the `Record<string, string>` the pipeline has
 * always carried.
 *
 * Every value becomes a string, as it is for CSV: coercion to number or enum
 * belongs to parseNormalize, which can attach per-field confidence and a
 * rejection reason. `null` becomes an empty cell, which is how a blank CSV
 * cell already reads.
 *
 * Structural problems throw rather than reject the row. A nested value, or two
 * keys that fold to the same column, means the file's *shape* is wrong for
 * every record, the same way a duplicate CSV column is - and one sentence naming
 * the record and field is more useful to the dealer than thousands of
 * identical per-row rejections.
 */
export function flatten(
  element: unknown,
  recordNumber: number,
): Record<string, string> {
  if (
    element === null ||
    typeof element !== 'object' ||
    Array.isArray(element)
  ) {
    throw new FileValidationError(
      `Record ${recordNumber} is not an object. Each vehicle must be a ` +
        'JSON object such as { "make": "Toyota", "model": "Aqua" }.',
    );
  }

  const out: Record<string, string> = {};
  const origin = new Map<string, string>();

  for (const [rawKey, value] of Object.entries(element)) {
    const column = normalizeHeader(rawKey);
    // A key that folds to nothing is not a real column - dropped, as the CSV
    // reader drops a header cell that normalised to empty.
    if (!column) continue;

    const earlier = origin.get(column);
    if (earlier !== undefined) {
      throw new FileValidationError(
        `Record ${recordNumber} has both "${earlier}" and "${rawKey}", which ` +
          `are the same column (${column}). Each column may appear only once.`,
      );
    }
    origin.set(column, rawKey);

    out[column] = stringify(value, rawKey, recordNumber);
  }

  return out;
}

function stringify(value: unknown, key: string, recordNumber: number): string {
  if (value === null || value === undefined) return '';

  switch (typeof value) {
    case 'string':
      return value.trim();
    case 'number':
    case 'boolean':
      return String(value);
    default:
      throw new FileValidationError(
        `Record ${recordNumber}: "${key}" must be a single value, not an ` +
          `${Array.isArray(value) ? 'array' : 'object'}. Use flat fields ` +
          'such as "sunroof": true, matching the CSV column names.',
      );
  }
}

async function* countBytes(
  source: unknown,
  onBytes: (n: number) => void,
): AsyncGenerator<Buffer | string> {
  for await (const chunk of source as AsyncIterable<Buffer | string>) {
    onBytes(
      typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength,
    );
    yield chunk;
  }
}
