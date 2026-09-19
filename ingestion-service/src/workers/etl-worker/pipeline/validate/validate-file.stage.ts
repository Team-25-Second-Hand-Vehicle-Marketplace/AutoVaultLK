import { parse } from 'csv-parse/sync';
import {
  normalizeHeader,
  REQUIRED_COLUMNS,
} from '../parse/csv-contract';
import type { StageContext, StageRunner } from '../types';

/**
 * Raised when a file cannot be processed at all. The orchestrator turns this
 * into a FAILED job with the message shown to the dealer.
 *
 * This is the deliberate exception to "a stage never throws because of
 * content". The rule exists so one bad row cannot fail a job — but a file with
 * no header row has no rows to reject, and reporting 5,000 identical per-row
 * rejections would be worse than one clear sentence. validateFile is the ONLY
 * stage permitted to fail a job on content; every stage after it works on rows
 * that are known to be parseable.
 */
export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileValidationError';
  }
}

export type ValidateFileInput = {
  /** ObjectStore key, `raw/{jobId}/{fileName}` — written by the Ingest API. */
  key: string;
  fileName: string;
};

export type ValidateFileOutput = {
  key: string;
  /** Canonical column names in file order, for splitChunks to reuse. */
  headers: string[];
  byteLength: number;
};

const ALLOWED_EXTENSIONS = ['.csv'];

/** Byte-order mark. Excel writes one; it must not reach the header parser. */
const BOM = '﻿';

/**
 * Headers can legitimately be long, but a "header line" of several hundred KB
 * means the file is not delimited the way we think it is — most often an XLSX
 * saved with a .csv extension, whose binary body has no newline for a long
 * while. Cheaper to detect here than to let csv-parse build a giant row.
 */
const MAX_HEADER_BYTES = 64 * 1024;

/**
 * Gate between an uploaded blob and the pipeline: extension, non-emptiness,
 * UTF-8 decodability, a parseable header row, and the required columns.
 *
 * Reads only the first MAX_HEADER_BYTES rather than the whole object. A 25 MB
 * upload buffered whole, across MaxConcurrency jobs, is a footprint worth
 * avoiding for a check that only ever looks at line one.
 */
export const validateFileStage: StageRunner<ValidateFileInput, ValidateFileOutput> = {
  stage: 'VALIDATE_FILE',

  async run(ctx: StageContext, input: ValidateFileInput): Promise<ValidateFileOutput> {
    const extension = extensionOf(input.fileName);
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      throw new FileValidationError(
        `Unsupported file type "${extension || 'none'}". Upload a .csv file.`,
      );
    }

    if (!(await ctx.store.exists(input.key))) {
      // Infrastructure-shaped, but the dealer's file genuinely is not there, so
      // it is reported as a file problem rather than crashing the worker.
      throw new FileValidationError('Uploaded file could not be read from storage.');
    }

    const head = await readHead(ctx, input.key);
    if (head.byteLength === 0) {
      throw new FileValidationError('File is empty.');
    }

    const text = decodeUtf8(head);
    const headerLine = firstLine(text);
    if (!headerLine.trim()) {
      throw new FileValidationError('File has no header row.');
    }

    const headers = parseHeaderRow(headerLine);
    assertNoDuplicates(headers);
    assertRequiredPresent(headers);

    return { key: input.key, headers, byteLength: head.byteLength };
  },
};

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

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

/**
 * Decodes strictly. A latin-1 or UTF-16 file would otherwise decode to
 * replacement characters and fail later as a mystery dictionary miss on every
 * row, rather than here as one comprehensible message.
 */
function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new FileValidationError(
      'File is not valid UTF-8. Re-export it as CSV UTF-8 and upload again.',
    );
  }
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
      'File does not look like CSV — no row separator found. ' +
        'If this is an Excel workbook, export it as CSV first.',
    );
  }

  return text;
}

function parseHeaderRow(line: string): string[] {
  let cells: string[][];
  try {
    cells = parse(line.replace(BOM, ''), { relaxColumnCount: true }) as string[][];
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
 * Two columns folding to the same canonical name is ambiguous — `make` and
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

function assertRequiredPresent(headers: string[]): void {
  const present = new Set(headers);
  const missing = REQUIRED_COLUMNS.filter((column) => !present.has(column));

  if (missing.length > 0) {
    throw new FileValidationError(
      `Missing required columns: ${missing.join(', ')}. ` +
        `Required: ${REQUIRED_COLUMNS.join(', ')}.`,
    );
  }
}
