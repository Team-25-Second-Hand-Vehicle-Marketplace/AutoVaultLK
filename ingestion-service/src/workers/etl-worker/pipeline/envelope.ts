import type { EtlStage } from '../../../infrastructure/database/entities/etl-stage-log.entity';

/**
 * What crosses a Step Functions state boundary.
 *
 * **Step Functions caps a state's input and output at 256 KB.** A chunk of 250
 * normalized rows carrying `search_text` is well past that, so rows never
 * travel between states — they live in the object store and only a pointer
 * moves. This type is that pointer, and it must stay small enough that a
 * 50-chunk Map's aggregated output is nowhere near the cap.
 *
 * At roughly 200 bytes per envelope, 50 chunks is ~10 KB.
 *
 * `LocalOrchestrator` threads the identical type. The two executors differ in
 * *who calls the next stage*, not in what is passed — which is what keeps them
 * from drifting into different pipelines.
 */
export type ChunkEnvelope = {
  jobId: string;
  /** Owning dealer, from the job row. Carried so a stage Lambda need not re-read it. */
  dealerId: string;
  chunkId: number;
  /** Object-store key of the rows this stage produced. Null once Load consumes them. */
  key: string | null;
  counts: ChunkCounts;
  /**
   * How the stage that produced this envelope finished. SKIPPED and DEGRADED
   * must survive the state boundary: a Groq stage that ran without a key is
   * SKIPPED, and recording it as SUCCEEDED would claim the LLM had run.
   */
  outcome?: 'SUCCEEDED' | 'SKIPPED' | 'DEGRADED';

  /**
   * Why the stage degraded — Groq unreachable, MiniLM unavailable. The chunk
   * is not a failure and its rows continue; this is what the stage log's
   * error_message carries.
   */
  degraded?: string;
};

export type ChunkCounts = {
  /** Rows that entered this stage. */
  in: number;
  /** Rows that survived it. */
  out: number;
  /** Rows rejected by this stage. Cumulative across the chunk's stages. */
  rejected: number;
};

/**
 * Where a stage writes its output.
 *
 * Per-stage prefixes rather than one key overwritten in place: a failed run
 * leaves every earlier stage's output intact, which is what makes an ASL retry
 * *from the failing state* possible at all. Overwriting would destroy the input
 * the retry needs.
 *
 * S3 lifecycle expires `staging/` after 7 days (ObjectStore's header).
 */
export function stageOutputKey(jobId: string, stage: EtlStage, chunkId: number): string {
  return `staging/${jobId}/${slug(stage)}/chunk-${pad(chunkId)}.json`;
}

/** splitChunks' output — the raw rows, before any stage has run. */
export function rawChunkKey(jobId: string, chunkId: number): string {
  return `staging/${jobId}/chunk-${pad(chunkId)}.json`;
}

/** `PARSE_NORMALIZE` -> `parse-normalize`, matching the src/lambda/* directories. */
function slug(stage: EtlStage): string {
  return stage.toLowerCase().replace(/_/g, '-');
}

/**
 * Zero-padded so keys sort in chunk order. `ObjectStore.list` sorts
 * lexicographically — unpadded, `chunk-10` precedes `chunk-2` and a retry
 * replays out of order.
 */
function pad(chunkId: number): string {
  return String(chunkId).padStart(3, '0');
}

/** Starting envelope for a chunk, before any row stage has run. */
export function initialEnvelope(
  jobId: string,
  dealerId: string,
  chunkId: number,
  rowCount: number,
): ChunkEnvelope {
  return {
    jobId,
    dealerId,
    chunkId,
    key: rawChunkKey(jobId, chunkId),
    counts: { in: rowCount, out: rowCount, rejected: 0 },
  };
}
