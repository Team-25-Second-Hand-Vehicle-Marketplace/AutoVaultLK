import type { ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import { getContext } from './bootstrap';

export type AggregateInput = {
  jobId: string;
  totalRecords: number;
  /**
   * The Map state's output — one entry per chunk. A chunk whose chain was
   * caught by ASL arrives as `{ failed: true }` rather than an envelope, which
   * is what lets the job end PARTIAL instead of FAILED.
   */
  chunks: (ChunkEnvelope | { failed: true })[];
};

export type AggregateOutput = {
  jobId: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  validRecords: number;
  invalidRecords: number;
};

/**
 * Step Functions state: Aggregate. Final counts and terminal status.
 *
 * Counts come from the database, not from the Map's output. A resumed
 * execution loads nothing new — its rows belong to the previous run — and
 * tallying only this run would report zero and downgrade a finished job to
 * FAILED on a harmless retry. That bug was found by running the in-process
 * orchestrator twice; the same reasoning applies here, and more sharply,
 * because ASL retries are routine.
 */
export const handler = async (input: AggregateInput): Promise<AggregateOutput> => {
  const ctx = await getContext();
  const log = ctx.stageLogs.forJob(input.jobId);
  const logId = await log.start('AGGREGATE', null);

  try {
    const loaded = await ctx.vehicles.countForJob(input.jobId);
    const rejected = await ctx.rejections.countForJob(input.jobId);
    const anyFailed = input.chunks.some((chunk) => 'failed' in chunk);

    await ctx.uploadJobs.updateCounts(input.jobId, {
      validRecords: loaded,
      invalidRecords: rejected,
    });

    // PARTIAL is the interesting case: the dealer got less than they uploaded
    // and needs to know which rows. FAILED is reserved for nothing landing.
    const status =
      loaded === 0 ? 'FAILED' : anyFailed || rejected > 0 ? 'PARTIAL' : 'COMPLETED';

    await ctx.uploadJobs.updateStatus(input.jobId, status);
    await log.finish(logId, 'SUCCEEDED', {
      metrics: { loaded, rejected, total: input.totalRecords, failedChunks: anyFailed },
    });

    return { jobId: input.jobId, status, validRecords: loaded, invalidRecords: rejected };
  } catch (err) {
    await log.finish(logId, 'FAILED', {
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};
