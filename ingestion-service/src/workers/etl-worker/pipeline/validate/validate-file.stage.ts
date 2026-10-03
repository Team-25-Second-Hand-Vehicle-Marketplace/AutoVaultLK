import unzipper from 'unzipper';
import type { UploadFileFormat } from '../../../../infrastructure/database/entities/upload-job.entity';
import { REQUIRED_COLUMNS } from '../parse/csv-contract';
import { readerFor } from '../parse/file-format';
import { FileValidationError } from '../parse/file-validation-error';
import type { StageContext, StageRunner } from '../types';

// Re-exported so the orchestrator and Lambdas keep importing it from here.
export { FileValidationError };

export type ValidateFileInput = {
  /** ObjectStore key, `raw/{jobId}/{fileName}` - written by the Ingest API. */
  key: string;
  fileName: string;
  /**
   * Format the dealer declared at upload; selects the reader. Absent means
   * CSV, which is what every job was before JSON support existed.
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
  /** Canonical column names, for splitChunks to reuse. */
  headers: string[];
  byteLength: number;
};

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

/**
 * Gate between an uploaded blob and the pipeline: extension, non-emptiness,
 * a readable structure, and the required columns.
 *
 * Everything that depends on the file's format - how it is decoded, where its
 * column names come from - is the reader's job (parse/file-format.ts). This
 * stage owns only what is true of every format: the extension matches, the
 * object exists, the required columns are present, the photo archive is sane.
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
    const format = input.format ?? 'csv';
    const reader = readerFor(format);

    const extension = extensionOf(input.fileName);
    if (extension !== reader.extension) {
      throw new FileValidationError(
        `Unsupported file type "${extension || 'none'}". Upload a ${reader.extension} file.`,
      );
    }

    if (!(await ctx.store.exists(input.key))) {
      // Infrastructure-shaped, but the dealer's file genuinely is not there, so
      // it is reported as a file problem rather than crashing the worker.
      throw new FileValidationError(
        'Uploaded file could not be read from storage.',
      );
    }

    const { headers, byteLength } = await reader.inspect(ctx, input.key);
    assertRequiredPresent(headers);

    if (input.zipKey) {
      await assertValidZip(ctx, input.zipKey);
    }

    return { key: input.key, format, headers, byteLength };
  },
};

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
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
