import { parse } from 'csv-parse/sync';
import unzipper from 'unzipper';
import type { UploadFileFormat } from '../../../../infrastructure/database/entities/upload-job.entity';
import { normalizeHeader, REQUIRED_COLUMNS } from '../parse/csv-contract';
import type { StageContext, StageRunner } from '../types';

/**
 * Raised when a file cannot be processed at all. The orchestrator turns this
 * into a FAILED job with the message shown to the dealer.
 *
 * This is the deliberate exception to "a stage never throws because of
 * content". The rule exists so one bad row cannot fail a job - but a file with
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
  /** ObjectStore key, `raw/{jobId}/{fileName}` - written by the Ingest API. */
  key: string;
  fileName: string;
  /**
   * Format the dealer declared at upload. Carried so the stage can pick its
   * reader; every job is still read as CSV until JSON readers land, so this is
   * not yet consulted.
   */
  format?: UploadFileFormat;
  /**
   * ObjectStore key of the dealer's photo archive, `raw/{jobId}/{zipFileName}`.
   * Optional: a dealer may upload inventory with no photos at all, which is
   * legitimate (FR-35.2 covers rows with no registration match). When present,
   * its structure is inspected here rather than only at extraction time deep
   * in the images branch - a malformed archive should fail the whole job with
   * one clear message before any CSV row is processed, not surface as an
   * "images failed" side-note after rows are already loaded.
   */
  zipKey?: string;
};

export type ValidateFileOutput = {
  key: string;
  /** Echoed so the next state does not have to re-read the job row. */
  format: UploadFileFormat;
  /** Canonical column names in file order, for splitChunks to reuse. */
  headers: string[];
  byteLength: number;
};

const ALLOWED_EXTENSIONS = ['.csv'];
const ALLOWED_ZIP_EXTENSIONS = ['.zip'];
const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

/**
 * A dealer's photo set is a few hundred images at most; anything past this
 * is either the wrong file or a zip bomb (a small archive that decompresses
 * to something enormous). Caught here, before extraction ever runs.
 */
const MAX_ZIP_ENTRIES = 2000;

/** Guards against a crafted archive whose declared uncompressed size is huge. */
const MAX_ZIP_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

/** Byte-order mark. Excel writes one; it must not reach the header parser. */
const BOM = '﻿';

/**
 * Headers can legitimately be long, but a "header line" of several hundred KB
 * means the file is not delimited the way we think it is - most often an XLSX
 * saved with a .csv extension, whose binary body has no newline for a long
 * while. Cheaper to detect here than to let csv-parse build a giant row.
 */
const MAX_HEADER_BYTES = 64 * 1024;

/**
 * Gate between an uploaded blob and the pipeline: extension, non-emptiness,
 * a decodable encoding, a parseable header row, and the required columns.
 *
 * Reads only the first MAX_HEADER_BYTES rather than the whole object. A 25 MB
 * upload buffered whole, across MaxConcurrency jobs, is a footprint worth
 * avoiding for a check that only ever looks at line one - except in the rare
 * case the file needs re-encoding, where the whole object is read once more;
 * see reencodeWholeFile.
 */
export const validateFileStage: StageRunner<
  ValidateFileInput,
  ValidateFileOutput
> = {
  stage: 'VALIDATE_FILE',

  async run(
    ctx: StageContext,
    input: ValidateFileInput,
  ): Promise<ValidateFileOutput> {
    const extension = extensionOf(input.fileName);
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      throw new FileValidationError(
        `Unsupported file type "${extension || 'none'}". Upload a .csv file.`,
      );
    }

    if (!(await ctx.store.exists(input.key))) {
      // Infrastructure-shaped, but the dealer's file genuinely is not there, so
      // it is reported as a file problem rather than crashing the worker.
      throw new FileValidationError(
        'Uploaded file could not be read from storage.',
      );
    }

    const head = await readHead(ctx, input.key);
    if (head.byteLength === 0) {
      throw new FileValidationError('File is empty.');
    }

    const decoded = decodeText(head);
    if (decoded.reencoded) {
      await reencodeWholeFile(ctx, input.key);
    }

    const headerLine = firstLine(decoded.text);
    if (!headerLine.trim()) {
      throw new FileValidationError('File has no header row.');
    }

    const headers = parseHeaderRow(headerLine);
    assertNoDuplicates(headers);
    assertRequiredPresent(headers);

    if (input.zipKey) {
      await assertValidZip(ctx, input.zipKey);
    }

    return {
      key: input.key,
      format: input.format ?? 'csv',
      headers,
      byteLength: head.byteLength,
    };
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

type DecodedHead = {
  text: string;
  /** True when the fallback below was needed - the file must be re-encoded. */
  reencoded: boolean;
};

/**
 * Windows-1252 is identical to Latin-1 everywhere except these 32 bytes,
 * where Latin-1 has unprintable C1 control codes and Windows-1252 has the
 * typographic punctuation Word/Excel's autocorrect actually inserts - smart
 * quotes, en/em dashes, an ellipsis. This is the one range a decode needs to
 * get right; every other byte (0x00-0x7F and 0xA0-0xFF) maps to itself in
 * both encodings, which is exactly what Buffer's built-in 'latin1' encoding
 * already does with no ICU dependency at all.
 *
 * Deliberately NOT `TextDecoder('windows-1252')`: on this Node build (full
 * ICU, v22.14) that silently decodes every byte as its own code point -
 * identical to Latin-1 - instead of applying this table, despite correctly
 * reporting `encoding: 'windows-1252'` on introspection. A dependency this
 * silently wrong on the one range that matters is worse than not having it;
 * this table has no runtime to be wrong about.
 */
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

/**
 * Decodes strictly as UTF-8 first, since a wrong guess there would otherwise
 * decode to replacement characters and fail later as a mystery dictionary
 * miss on every row, rather than here as one comprehensible message. Falls
 * back to Windows-1252 rather than rejecting outright: it is what Excel's
 * default "Save As CSV" writes on Windows, which is the single most common
 * reason a dealer's otherwise-fine file fails this check, and - being a
 * single-byte encoding with a character at every value - it can never throw
 * the way a wrong guess at UTF-16 or a genuinely binary file still will. A
 * file that is neither still gets caught below, just by the header/column
 * checks instead of a specific encoding complaint.
 */
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

/**
 * Rewrites the object at `key` as UTF-8, translating from the Windows-1252
 * bytes Excel wrote. Every stage after this one - csv-parse in splitChunks
 * chief among them - reads this same key assuming UTF-8; without this, a
 * dealer's file would pass validation only to have every accented letter,
 * curly quote or dash silently turn into "�" the moment a row is actually
 * parsed, which is a worse outcome than the clean rejection this replaces.
 *
 * Only reached on the encoding-mismatch path, so the whole-object read this
 * needs - as opposed to readHead's early-stop streaming - only ever costs
 * something for the rare file that actually needs re-encoding.
 */
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
    cells = parse(line.replace(BOM, ''), {
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

/**
 * Structural check on the dealer's photo archive: is it actually a ZIP,
 * does its central directory list a sane number of entries at a sane total
 * size, does every entry stay inside the archive root, and is every entry
 * an image extractFn already knows how to handle.
 *
 * Reads only the central directory (unzipper.Open.buffer parses the
 * directory record at the end of the file; it does not decompress entry
 * bodies), so this stays cheap even for a large archive - the same
 * `unzipper.Open.buffer` call extractImagesStage makes, but without ever
 * calling `entry.buffer()`.
 *
 * A dealer with no non-image entries and no photos at all is not a defect:
 * the CSV rows still load, they simply carry no automated image match
 * (FR-35.2). This check only rejects a ZIP that cannot be trusted to open
 * safely, not one that happens to be empty or partial.
 */
async function assertValidZip(
  ctx: StageContext,
  zipKey: string,
): Promise<void> {
  const extension = extensionOf(zipKey);
  if (!ALLOWED_ZIP_EXTENSIONS.includes(extension)) {
    throw new FileValidationError(
      `Unsupported photo archive type "${extension || 'none'}". Upload a .zip file.`,
    );
  }

  if (!(await ctx.store.exists(zipKey))) {
    throw new FileValidationError(
      'Uploaded photo archive could not be read from storage.',
    );
  }

  const zipBuffer = await ctx.store.get(zipKey);

  let directory: Awaited<ReturnType<typeof unzipper.Open.buffer>>;
  try {
    directory = await unzipper.Open.buffer(zipBuffer);
  } catch {
    throw new FileValidationError(
      'Photo archive is not a valid ZIP file, or is corrupted.',
    );
  }

  const files = directory.files.filter((entry) => entry.type === 'File');

  if (files.length > MAX_ZIP_ENTRIES) {
    throw new FileValidationError(
      `Photo archive has ${files.length} entries, which exceeds the ${MAX_ZIP_ENTRIES} limit.`,
    );
  }

  let totalUncompressedBytes = 0;

  for (const entry of files) {
    const normalized = entry.path.replace(/\\/g, '/');

    if (
      normalized.startsWith('/') ||
      normalized.includes('../') ||
      normalized.includes('..\\')
    ) {
      throw new FileValidationError(
        `Photo archive contains an unsafe path: ${entry.path}`,
      );
    }

    totalUncompressedBytes += entry.uncompressedSize ?? 0;
    if (totalUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new FileValidationError(
        'Photo archive decompresses to more data than allowed.',
      );
    }
  }

  const nonImageEntries = files.filter(
    (entry) => !ALLOWED_IMAGE_EXTENSIONS.includes(imageExtensionOf(entry.path)),
  );

  // Not fatal on its own - a dealer export sometimes carries a stray
  // Thumbs.db or .DS_Store - but a majority-non-image archive usually means
  // the wrong file was zipped and uploaded, which is worth failing early
  // rather than silently matching zero photos later.
  if (files.length > 0 && nonImageEntries.length === files.length) {
    throw new FileValidationError(
      'Photo archive contains no recognised image files (.jpg, .jpeg, .png, .webp).',
    );
  }
}

function imageExtensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
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
