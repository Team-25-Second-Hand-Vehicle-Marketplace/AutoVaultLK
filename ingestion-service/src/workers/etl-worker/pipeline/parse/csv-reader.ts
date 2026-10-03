import { parse } from 'csv-parse';
import { parse as parseSync } from 'csv-parse/sync';
import { normalizeHeader } from './csv-contract';
import { FileValidationError } from './file-validation-error';
import type { FormatReader, InspectedFile } from './file-format';
import type { StageContext } from '../types';

/** Byte-order mark. Excel writes one; it must not reach the header parser. */
const BOM = '﻿';

/**
 * Headers can legitimately be long, but a "header line" of several hundred KB
 * means the file is not delimited the way we think it is - most often an XLSX
 * saved with a .csv extension, whose binary body has no newline for a long
 * while. Cheaper to detect here than to let csv-parse build a giant row.
 */
const MAX_HEADER_BYTES = 64 * 1024;

export const csvReader: FormatReader = {
  extension: '.csv',

  async inspect(ctx: StageContext, key: string): Promise<InspectedFile> {
    const head = await readHead(ctx, key);
    if (head.byteLength === 0) {
      throw new FileValidationError('File is empty.');
    }

    const decoded = decodeText(head);
    if (decoded.reencoded) {
      await reencodeWholeFile(ctx, key);
    }

    const headerLine = firstLine(decoded.text);
    if (!headerLine.trim()) {
      throw new FileValidationError('File has no header row.');
    }

    const headers = parseHeaderRow(headerLine);
    assertNoDuplicates(headers);

    return { headers, byteLength: head.byteLength };
  },

  async *rows(
    ctx: StageContext,
    key: string,
  ): AsyncIterable<Record<string, string>> {
    const stream = await ctx.store.getStream(key);

    const parser = parse({
      bom: true,
      columns: (header: string[]) => header.map(normalizeHeader),
      // Short and long rows are row-level defects, not file-level ones: a
      // dealer's export with one ragged line must reject that line and load
      // the rest. Without this csv-parse aborts the whole stream.
      relaxColumnCount: true,
      skipEmptyLines: true,
      trim: true,
    });

    for await (const record of stream.pipe(parser)) {
      yield toStringRecord(record as Record<string, unknown>);
    }
  },
};

/** Streams only as far as the header check needs, then stops pulling. */
async function readHead(ctx: StageContext, key: string): Promise<Buffer> {
  const stream = await ctx.store.getStream(key);
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    total += buffer.byteLength;
    if (total >= MAX_HEADER_BYTES) break;
  }

  return Buffer.concat(chunks);
}

type DecodedHead = {
  text: string;
  /** True when the fallback below was needed - the file must be re-encoded. */
  reencoded: boolean;
};

const WINDOWS_1252_HIGH_RANGE: Readonly<Record<number, string>> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

function decodeWindows1252(buffer: Buffer): string {
  const chars = new Array<string>(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    chars[i] = WINDOWS_1252_HIGH_RANGE[byte] ?? String.fromCharCode(byte);
  }
  return chars.join('');
}

function decodeText(buffer: Buffer): DecodedHead {
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
      reencoded: false,
    };
  } catch {
    return { text: decodeWindows1252(buffer), reencoded: true };
  }
}

async function reencodeWholeFile(
  ctx: StageContext,
  key: string,
): Promise<void> {
  const stream = await ctx.store.getStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const utf8Text = decodeWindows1252(Buffer.concat(chunks));
  await ctx.store.put(key, utf8Text, 'text/csv');
}

/**
 * The header row cannot simply be split on the first newline: a quoted header
 * cell may legally contain one. Take the first *logical* line by tracking
 * quotes, so `"model, trim",price` stays intact.
 */
function firstLine(text: string): string {
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not a close.
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && (char === '\n' || char === '\r')) {
      return text.slice(0, i);
    }
  }

  // No newline within the window: either a single-line file or, if we stopped
  // at the cap, something that is not line-delimited at all.
  if (text.length >= MAX_HEADER_BYTES) {
    throw new FileValidationError(
      'File does not look like CSV - no row separator found. ' +
        'If this is an Excel workbook, export it as CSV first.',
    );
  }

  return text;
}

function parseHeaderRow(line: string): string[] {
  let cells: string[][];
  try {
    cells = parseSync(line.replace(BOM, ''), {
      relaxColumnCount: true,
    }) as string[][];
  } catch {
    throw new FileValidationError('Header row could not be parsed as CSV.');
  }

  const row = cells[0];
  if (!row || row.length === 0) {
    throw new FileValidationError('File has no header row.');
  }

  return row.map(normalizeHeader);
}

/**
 * Two columns folding to the same canonical name is ambiguous - `make` and
 * `Manufacturer` both mean `make`, and picking one would silently discard the
 * other's data for every row in the file.
 */
function assertNoDuplicates(headers: string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const header of headers) {
    if (!header) continue;
    if (seen.has(header)) duplicates.add(header);
    seen.add(header);
  }

  if (duplicates.size > 0) {
    throw new FileValidationError(
      `Duplicate columns: ${[...duplicates].sort().join(', ')}. ` +
        'Each column may appear only once.',
    );
  }
}

function toStringRecord(
  record: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(record)) {
    if (!key || key === 'undefined') continue;
    out[key] =
      value == null
        ? ''
        : typeof value === 'string'
          ? value
          : JSON.stringify(value);
  }

  return out;
}
