import type { UploadFileFormat } from '../../../../infrastructure/database/entities/upload-job.entity';
import { readerFor } from './file-format';
import type { RawRow, StageContext, StageRunner } from '../types';

export type SplitChunksInput = {
  key: string;
  /** Selects the reader. Absent means CSV, as every job was before JSON. */
  format?: UploadFileFormat;
  /** Canonical headers from validateFile - re-derived, not trusted blindly. */
  headers: string[];
};

export type SplitChunksOutput = {
  /** ObjectStore keys, in row order: `staging/{jobId}/chunk-{n}.json`. */
  chunkKeys: string[];
  totalRecords: number;
};

/**
 * Splits the validated file into fixed-size chunks on the ObjectStore, so the
 * rest of the pipeline fans out over chunks rather than rows.
 *
 * The format-specific part - decoding the file into one string record per row -
 * is the reader's (parse/file-format.ts). From here on a CSV job and a JSON job
 * are indistinguishable: both write the same RawRow chunks.
 *
 * Streamed end to end: rows accumulate only up to `config.chunkSize` before
 * being flushed and dropped. A 25 MB upload therefore costs one chunk of
 * memory, not 25 MB - and under MaxConcurrency 10 that difference is the
 * whole footprint of the worker.
 *
 * Chunk files are the unit of retry. The orchestrator skips chunks already
 * logged as succeeded (EtlStageLogRepository.succeededChunks), which is what
 * keeps a re-run from double-inserting rows whose registration_number is null
 * and therefore missed by both partial unique indexes.
 */
export const splitChunksStage: StageRunner<SplitChunksInput, SplitChunksOutput> = {
  stage: 'SPLIT_CHUNKS',

  async run(ctx: StageContext, input: SplitChunksInput): Promise<SplitChunksOutput> {
    const chunkSize = Math.max(1, ctx.config.chunkSize);
    const reader = readerFor(input.format ?? 'csv');

    const chunkKeys: string[] = [];
    let buffer: RawRow[] = [];
    let rowNumber = 0;
    let totalRecords = 0;

    const flush = async (): Promise<void> => {
      if (buffer.length === 0) return;
      const key = chunkKey(ctx.jobId, chunkKeys.length);
      await ctx.store.put(key, JSON.stringify(buffer), 'application/json');
      chunkKeys.push(key);
      buffer = [];
    };

    for await (const raw of reader.rows(ctx, input.key)) {
      rowNumber++;

      // A row of nothing but empty cells is trailing spreadsheet noise, not a
      // vehicle the dealer failed to describe. Rejecting it would put dozens of
      // meaningless entries in front of them.
      if (isBlank(raw)) continue;

      buffer.push({ rowNumber, raw });
      totalRecords++;

      if (buffer.length >= chunkSize) await flush();
    }

    await flush();

    return { chunkKeys, totalRecords };
  },
};

/** `chunk-000` … so the keys sort lexicographically in ObjectStore.list. */
export function chunkKey(jobId: string, index: number): string {
  return `staging/${jobId}/chunk-${String(index).padStart(3, '0')}.json`;
}

function isBlank(raw: Record<string, string>): boolean {
  return Object.values(raw).every((value) => value.trim() === '');
}
