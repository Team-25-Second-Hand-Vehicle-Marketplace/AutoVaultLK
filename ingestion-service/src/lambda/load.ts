import { readRows } from '../workers/etl-worker/pipeline/chunk-stage';
import type { ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import { createLoadStage } from '../workers/etl-worker/pipeline/persistence/load.stage';
import type { EmbeddedRow } from '../workers/etl-worker/pipeline/types';
import { getContext, stageContext } from './bootstrap';

export const handler = async (envelope: ChunkEnvelope): Promise<ChunkEnvelope> => {
  const ctx = await getContext();
  const log = ctx.stageLogs.forJob(envelope.jobId);
  const logId = await log.start('LOAD', envelope.chunkId);

  try {
    const stageCtx = stageContext(ctx, {
      jobId: envelope.jobId,
      dealerId: envelope.dealerId,
      chunkId: envelope.chunkId,
    });

    const rows = await readRows<EmbeddedRow>(stageCtx, envelope);
    const result = await createLoadStage(ctx.vehicles).run(stageCtx, rows);

    // Load's rejections are cross-job duplicate registrations the database
    // refused. Recorded under LOAD so an ASL retry replaces exactly its own
    // set rather than duplicating it.
    await ctx.rejections.insertMany(envelope.jobId, 'LOAD', result.rejections);

    await log.finish(logId, 'SUCCEEDED', {
      metrics: { loaded: result.loaded.length, rejected: result.rejections.length },
    });

    return {
      ...envelope,
      key: null,
      counts: {
        in: rows.length,
        out: result.loaded.length,
        rejected: envelope.counts.rejected + result.rejections.length,
      },
    };
  } catch (err) {
    await log.finish(logId, 'FAILED', {
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};
