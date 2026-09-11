import { asChunkStage, type StageOutcome } from '../workers/etl-worker/pipeline/chunk-stage';
import type { ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import type { StageResult, StageRunner } from '../workers/etl-worker/pipeline/types';
import { getContext, stageContext } from './bootstrap';

/**
 * The body of every per-chunk stage handler.
 *
 * Each `src/lambda/*.ts` is three lines around this call, which is the point:
 * the Lambda boundary should add packaging, not behaviour. Anything that
 * belongs to the pipeline lives in the stage or in `asChunkStage`, so
 * `LocalOrchestrator` and Step Functions run identical code.
 *
 * Errors propagate. ASL's Retry and Catch are what handle them — a handler
 * that swallowed a failure would return a well-formed envelope claiming the
 * stage succeeded, and the state machine would carry on with rows that were
 * never written.
 */
export async function runChunkStage<TIn, TOut>(
  stage: StageRunner<TIn[], StageResult<TOut> & { outcome?: StageOutcome; error?: string }>,
  envelope: ChunkEnvelope,
): Promise<ChunkEnvelope> {
  const ctx = await getContext();
  const log = ctx.stageLogs.forJob(envelope.jobId);

  // Logged per invocation rather than per job so a retried state gets its own
  // row: ingestion.etl_stage_logs is how a dealer's progress is reported, and
  // a silent retry would look like a stage that simply took longer.
  const logId = await log.start(stage.stage, envelope.chunkId);

  try {
    const wrapped = asChunkStage(stage, { rejections: ctx.rejections });
    const result = await wrapped.run(
      stageContext(ctx, {
        jobId: envelope.jobId,
        dealerId: envelope.dealerId,
        chunkId: envelope.chunkId,
      }),
      envelope,
    );

    await log.finish(logId, result.outcome ?? 'SUCCEEDED', {
      metrics: { in: result.counts.in, out: result.counts.out },
      errorMessage: result.degraded,
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.finish(logId, 'FAILED', { errorMessage: message });
    throw err;
  }
}
