import type { UploadFileFormat } from '../../../../infrastructure/database/entities/upload-job.entity';
import type { StageContext } from '../types';
import { csvReader } from './csv-reader';
import { jsonReader } from './json-reader';

export type InspectedFile = {
  /** Canonical column names, for the required-column check and splitChunks. */
  headers: string[];
  byteLength: number;
};

/**
 * One reader per upload format. Everything format-specific lives behind this
 * interface - how a file is decoded, where its column names come from, how it
 * is cut into records - so the stages around it, and every stage after
 * splitChunks, see the same shape whichever format the dealer chose.
 */
export type FormatReader = {
  /** The extension a file in this format must carry, e.g. `.csv`. */
  extension: string;

  /**
   * File-level checks: encoding, structure, duplicate or colliding columns.
   * Returns the canonical column set. Throws FileValidationError on a defect
   * no per-row rejection could describe. The required-column check is not
   * here - it is format-independent and runs in validateFile.
   */
  inspect(ctx: StageContext, key: string): Promise<InspectedFile>;

  /**
   * One record per source row, keys already folded through normalizeHeader and
   * every value a string - the contract RawRow.raw has always had.
   */
  rows(ctx: StageContext, key: string): AsyncIterable<Record<string, string>>;
};

const READERS: Record<UploadFileFormat, FormatReader> = {
  csv: csvReader,
  json: jsonReader,
};

export function readerFor(format: UploadFileFormat): FormatReader {
  return READERS[format];
}
