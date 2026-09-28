import type { ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import { getContext } from './bootstrap';

export type AggregateInput = {
  jobId: string;
  totalRecords: number;

  chunks: (ChunkEnvelope | { failed: true })[];
};

export type AggregateOutput = {
  jobId: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  validRecords: number;
  invalidRecords: number;
};

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
