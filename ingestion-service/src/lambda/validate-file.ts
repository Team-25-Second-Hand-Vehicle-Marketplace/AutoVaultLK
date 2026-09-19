import {
  FileValidationError,
  validateFileStage,
} from '../workers/etl-worker/pipeline/validate/validate-file.stage';
import { getContext, stageContext } from './bootstrap';

export type ValidateFileInput = { jobId: string };

export type ValidateFileOutput = {
  jobId: string;
  dealerId: string;
  key: string;
  headers: string[];
};

/**
 * Step Functions state: ValidateFile. The first state, and the only one
 * permitted to fail a whole job on content.
 *
 * Does not use runChunkStage: this is a whole-file stage with no envelope, no
 * chunk id and no rows to write.
 *
 * Reads the job row rather than trusting the message, exactly as the JobQueue
 * port documents — a redelivered or replayed SQS message must not be able to
 * resurrect stale field values.
 */
export const handler = async (input: ValidateFileInput): Promise<ValidateFileOutput> => {
  const ctx = await getContext();
  const job = await ctx.uploadJobs.findById(input.jobId);

  if (!job) {
    // Nothing to mark FAILED — the row the status would live on is the one
    // that is missing. Throwing lets ASL's top-level Catch record it.
    throw new Error(`Upload job ${input.jobId} not found`);
  }

  await ctx.uploadJobs.updateStatus(job.id, 'PROCESSING');

  const log = ctx.stageLogs.forJob(job.id);
  const logId = await log.start('VALIDATE_FILE', null);

  try {
    const result = await validateFileStage.run(
      stageContext(ctx, { jobId: job.id, dealerId: job.dealerId, chunkId: null }),
      { key: job.csvS3Path, fileName: job.fileName },
    );

    await log.finish(logId, 'SUCCEEDED', { metrics: { columns: result.headers.length } });

    return {
      jobId: job.id,
      dealerId: job.dealerId,
      key: result.key,
      headers: result.headers,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.finish(logId, 'FAILED', { errorMessage: message });

    // A file defect is the dealer's to see, not just an execution failure in
    // the console. Row 0 is the whole-file rejection; the partial unique index
    // on (upload_job_id, stage) WHERE row_number = 0 keeps a retry from
    // stacking duplicates.
    if (err instanceof FileValidationError) {
      await ctx.rejections.insertMany(job.id, 'VALIDATE_FILE', [
        { rowNumber: 0, rawData: {}, reason: message },
      ]);
    }

    throw err;
  }
};
