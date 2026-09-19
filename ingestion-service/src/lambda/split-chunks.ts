import { initialEnvelope, type ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import { splitChunksStage } from '../workers/etl-worker/pipeline/parse/split-chunks.stage';
import { getContext, stageContext } from './bootstrap';
import type { ValidateFileOutput } from './validate-file';

export type SplitChunksOutput = {
  jobId: string;
  dealerId: string;
  totalRecords: number;
  /** One envelope per chunk. This array is the Map state's input. */
  chunks: ChunkEnvelope[];
};

/**
 * Step Functions state: SplitChunks. Streams the file into per-chunk JSON on
 * the object store and produces the Map state's input.
 *
 * **The output is envelopes, not rows.** Each is ~200 bytes, so a 50-chunk job
 * hands the Map about 10KB — comfortably inside the 256KB state-payload cap
 * that made this whole pointer design necessary.
 *
 * A file with more than a few hundred chunks would eventually approach that
 * cap even with pointers. At chunkSize 250 that is 100,000+ rows, well past
 * INGESTION_MAX_UPLOAD_MB, so the file-size limit is what bounds it.
 */
export const handler = async (input: ValidateFileOutput): Promise<SplitChunksOutput> => {
  const ctx = await getContext();
  const log = ctx.stageLogs.forJob(input.jobId);
  const logId = await log.start('SPLIT_CHUNKS', null);

  try {
    const result = await splitChunksStage.run(
      stageContext(ctx, { jobId: input.jobId, dealerId: input.dealerId, chunkId: null }),
      { key: input.key, headers: input.headers },
    );

    // Recorded before the Map fans out, so a job that dies mid-flight still
    // shows the denominator the dealer's progress bar needs.
    await ctx.uploadJobs.updateTotal(input.jobId, result.totalRecords);
    await log.finish(logId, 'SUCCEEDED', {
      metrics: { chunks: result.chunkKeys.length, rows: result.totalRecords },
    });

    // Row counts per chunk are not known here without re-reading each file —
    // splitChunks reports only the total. The first stage's envelope corrects
    // `in` from what it actually reads, so this is a starting value rather
    // than a claim.
    const chunks = result.chunkKeys.map((_key, index) =>
      initialEnvelope(input.jobId, input.dealerId, index, 0),
    );

    return {
      jobId: input.jobId,
      dealerId: input.dealerId,
      totalRecords: result.totalRecords,
      chunks,
    };
  } catch (err) {
    await log.finish(logId, 'FAILED', {
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};
