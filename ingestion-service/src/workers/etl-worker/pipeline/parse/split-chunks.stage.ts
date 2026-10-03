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
