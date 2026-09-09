import type { EtlStage } from '../../../infrastructure/database/entities/etl-stage-log.entity';
import { stageOutputKey, type ChunkEnvelope } from './envelope';
import type { Rejection, StageContext, StageResult, StageRunner } from './types';

/**
 * Persists the rejections a stage produced.
 *
 * An interface rather than the repository itself so stages stay free of
 * TypeORM — the same reason StageLogger exists.
 * `RejectedRecordRepository.insertMany` satisfies it, and is idempotent by
 * (job, stage, row) so a retried stage replaces its own rejections rather than
 * duplicating them.
 */
export interface RejectionSink {
  insertMany(uploadJobId: string, stage: EtlStage, rejections: Rejection[]): Promise<void>;
}

/**
 * A stage as Step Functions sees it: envelope in, envelope out.
 *
 * The rows themselves never cross a state boundary — they are read from the
 * object store at the start and written back at the end. See envelope.ts for
 * why (the 256 KB state-payload cap).
 */
export type ChunkStage = {
  readonly stage: EtlStage;
  run(ctx: StageContext, envelope: ChunkEnvelope): Promise<ChunkEnvelope>;
};

/**
 * What a stage may report beyond its rows. Groq and Embed both do.
 *
 * SKIPPED and DEGRADED are not the same thing and must not collapse into
 * SUCCEEDED: SKIPPED means the stage correctly did nothing (no Groq key, or no
 * candidates), DEGRADED means it tried and could not. A stage log that showed
 * SUCCEEDED for both would hide an outage behind a normal-looking run.
 */
type MaybeDegradable = { outcome?: StageOutcome; error?: string };

export type StageOutcome = 'SUCCEEDED' | 'SKIPPED' | 'DEGRADED';

/**
 * Wraps a row-processing stage so it can run as its own Lambda.
 *
 * **The inner stage is not modified.** It still takes rows and returns
 * `{ rows, rejections }`; this adds only the four things a Lambda boundary
 * requires — read input, persist rejections, write output, return a pointer.
 * That is deliberate: every stage's unit tests exercise the inner function, and
 * they must keep passing untouched or the wrapper has changed behaviour it had
 * no business changing.
 *
 * Rejections are persisted *here*, by the stage that produced them, rather than
 * accumulated. In-process the orchestrator could collect them across stages and
 * write once; across Lambdas that accumulator cannot exist, and a stage that
 * fails after rejecting rows would otherwise lose them.
 *
 * A stage reporting `outcome: 'DEGRADED'` — Groq unreachable, MiniLM missing —
 * has that carried on the envelope. Without it the stage log would show a
 * successful run and nobody would learn the embeddings are absent.
 */
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
 * A null key means the previous stage produced nothing to carry forward — Load
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
