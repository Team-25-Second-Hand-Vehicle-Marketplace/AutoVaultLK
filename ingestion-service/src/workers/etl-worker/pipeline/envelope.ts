import type { EtlStage } from '../../../infrastructure/database/entities/etl-stage-log.entity';

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
   * Why the stage degraded - Groq unreachable, MiniLM unavailable. The chunk
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

export function stageOutputKey(jobId: string, stage: EtlStage, chunkId: number): string {
  return `staging/${jobId}/${slug(stage)}/chunk-${pad(chunkId)}.json`;
}

/** splitChunks' output - the raw rows, before any stage has run. */
export function rawChunkKey(jobId: string, chunkId: number): string {
  return `staging/${jobId}/chunk-${pad(chunkId)}.json`;
}

/** `PARSE_NORMALIZE` -> `parse-normalize`, matching the src/lambda/* directories. */
function slug(stage: EtlStage): string {
  return stage.toLowerCase().replace(/_/g, '-');
}

/**
 * Zero-padded so keys sort in chunk order. `ObjectStore.list` sorts
 * lexicographically - unpadded, `chunk-10` precedes `chunk-2` and a retry
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
