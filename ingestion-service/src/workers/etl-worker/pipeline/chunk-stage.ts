import type { EtlStage } from '../../../infrastructure/database/entities/etl-stage-log.entity';
import { stageOutputKey, type ChunkEnvelope } from './envelope';
import type { Rejection, StageContext, StageResult, StageRunner } from './types';

export interface RejectionSink {
  insertMany(uploadJobId: string, stage: EtlStage, rejections: Rejection[]): Promise<void>;
}

/**
 * A stage as Step Functions sees it: envelope in, envelope out.
 *
 * The rows themselves never cross a state boundary - they are read from the
 * object store at the start and written back at the end. See envelope.ts for
 * why (the 256 KB state-payload cap).
 */
export type ChunkStage = {
  readonly stage: EtlStage;
  run(ctx: StageContext, envelope: ChunkEnvelope): Promise<ChunkEnvelope>;
};

type MaybeDegradable = { outcome?: StageOutcome; error?: string };

export type StageOutcome = 'SUCCEEDED' | 'SKIPPED' | 'DEGRADED';

export function asChunkStage<TIn, TOut>(
  inner: StageRunner<TIn[], StageResult<TOut> & MaybeDegradable>,
  deps: { rejections: RejectionSink },
): ChunkStage {
  return {
    stage: inner.stage,

    async run(ctx: StageContext, envelope: ChunkEnvelope): Promise<ChunkEnvelope> {
      const rows = await readRows<TIn>(ctx, envelope);
      const result = await inner.run(ctx, rows);

      await deps.rejections.insertMany(envelope.jobId, inner.stage, result.rejections);

      const key = stageOutputKey(envelope.jobId, inner.stage, envelope.chunkId);
      await ctx.store.put(key, JSON.stringify(result.rows), 'application/json');

      return {
        ...envelope,
        key,
        counts: {
          in: rows.length,
          out: result.rows.length,
          // Cumulative: a dealer's total is the last envelope's count, not a
          // sum across stages that would need every intermediate envelope.
          rejected: envelope.counts.rejected + result.rejections.length,
        },
        // Carried so the orchestrator can log the stage's real status. A
        // SKIPPED Groq stage recorded as SUCCEEDED would claim the LLM ran.
        outcome: result.outcome,
        ...(result.outcome === 'DEGRADED'
          ? { degraded: result.error ?? `${inner.stage} degraded` }
          : {}),
      };
    },
  };
}

/**
 * Reads a stage's input rows.
 *
 * A null key means the previous stage produced nothing to carry forward - Load
 * is the only stage that does this, and nothing runs after it. Treated as an
 * empty batch rather than an error so the shape stays total.
 */
export async function readRows<T>(
  ctx: StageContext,
  envelope: ChunkEnvelope,
): Promise<T[]> {
  if (!envelope.key) return [];

  const body = await ctx.store.get(envelope.key);
  return JSON.parse(body.toString('utf8')) as T[];
}
