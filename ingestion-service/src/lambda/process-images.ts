import { getContext } from './bootstrap';

export type ProcessImagesInput = {
  jobId: string;
  zipKey: string | null;
};

export type ProcessImagesOutput = {
  jobId: string;
  extracted: number;
  processed: number;
  skipped: number;
  unmatched: number;
  duplicates: number;
  failed: number;
};

/**
 * Step Functions state: ProcessImages. Runs inside the Parallel state's
 * second branch, alongside ProcessChunks — not sequentially after it.
 * Photos come from the ZIP and depend on nothing in the text pipeline, so
 * running the two concurrently cuts wall-clock time on a large upload
 * instead of paying for image processing on top of the Map's duration.
 *
 * **The cost of running concurrently:** a vehicle row this branch needs to
 * match a photo against may not exist yet — Load for that row's chunk may
 * still be running, or queued behind another chunk under MaxConcurrency.
 * ProcessJobImagesService's registration-number lookup retries with a
 * bounded budget for exactly this reason (see its own header comment); only
 * a row that never lands at all (rejected, or a registration number with no
 * matching row in this job) ends up genuinely unmatched.
 *
 * **Never fails the execution on a row-image mismatch.** Every rejection
 * this stage can produce — no matching vehicle, a corrupt image, a
 * duplicate — is counted and returned, not thrown; only an infrastructure
 * failure (S3, the database) propagates, exactly like every other stage.
 */
export const handler = async (
  input: ProcessImagesInput,
): Promise<ProcessImagesOutput> => {
  const ctx = await getContext();
  const log = ctx.stageLogs.forJob(input.jobId);
  const logId = await log.start('PROCESS_IMAGES', null);

  if (!input.zipKey) {
    await log.finish(logId, 'SKIPPED', { metrics: { reason: 'no_zip' } });
    return {
      jobId: input.jobId,
      extracted: 0,
      processed: 0,
      skipped: 0,
      unmatched: 0,
      duplicates: 0,
      failed: 0,
    };
  }

  try {
    const result = await ctx.imageProcessing.run(ctx.store, {
      jobId: input.jobId,
      zipKey: input.zipKey,
    });

    await log.finish(
      logId,
      result.failed > 0 || result.unmatched > 0 ? 'DEGRADED' : 'SUCCEEDED',
      { metrics: result },
    );

    return { jobId: input.jobId, ...result };
  } catch (err) {
    await log.finish(logId, 'FAILED', {
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};
