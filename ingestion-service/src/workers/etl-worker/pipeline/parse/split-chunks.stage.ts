import { parse } from 'csv-parse';
import { normalizeHeader } from './csv-contract';
import type { RawRow, StageContext, StageRunner } from '../types';

export type SplitChunksInput = {
  key: string;
  /** Canonical headers from validateFile — re-derived, not trusted blindly. */
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
 * Streamed end to end: rows accumulate only up to `config.chunkSize` before
 * being flushed and dropped. A 25 MB upload therefore costs one chunk of
 * memory, not 25 MB — and under MaxConcurrency 10 that difference is the
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
    const stream = await ctx.store.getStream(input.key);

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

    for await (const record of (stream as NodeJS.ReadableStream).pipe(parser)) {
      rowNumber++;

      const raw = toStringRecord(record as Record<string, unknown>);
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

/**
 * Every value is carried as a string. Coercion to number/enum belongs to
 * parseNormalize, which can attach a per-field confidence and a rejection
 * reason; doing it here would throw that context away.
 *
 * relaxColumnCount gives extra cells the key `undefined`, and a header cell
 * that normalized to empty gives `''` — neither is a real column, so both are
 * dropped rather than travelling into rejected_records.raw_data as noise.
 */
function toStringRecord(record: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(record)) {
    if (!key || key === 'undefined') continue;
    out[key] = value == null ? '' : String(value);
  }

  return out;
}

function isBlank(raw: Record<string, string>): boolean {
  return Object.values(raw).every((value) => value.trim() === '');
}
