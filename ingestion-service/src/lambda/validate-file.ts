import type { UploadFileFormat } from '../infrastructure/database/entities/upload-job.entity';
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
  format: UploadFileFormat;
  headers: string[];
  zipKey: string | null;
};

export const handler = async (input: ValidateFileInput): Promise<ValidateFileOutput> => {
  const ctx = await getContext();
  const job = await ctx.uploadJobs.findById(input.jobId);

  if (!job) {
    // Nothing to mark FAILED - the row the status would live on is the one
    // that is missing. Throwing lets ASL's top-level Catch record it.
    throw new Error(`Upload job ${input.jobId} not found`);
  }

  await ctx.uploadJobs.updateStatus(job.id, 'PROCESSING');

  const log = ctx.stageLogs.forJob(job.id);
  const logId = await log.start('VALIDATE_FILE', null);

  try {
    const result = await validateFileStage.run(
      stageContext(ctx, { jobId: job.id, dealerId: job.dealerId, chunkId: null }),
      {
        key: job.csvS3Path,
        fileName: job.fileName,
        format: job.fileFormat,
        zipKey: job.zipS3Path ?? undefined,
      },
    );

    await log.finish(logId, 'SUCCEEDED', { metrics: { columns: result.headers.length } });

    return {
      jobId: job.id,
      dealerId: job.dealerId,
      key: result.key,
      format: result.format,
      headers: result.headers,
      // Carried forward through SplitChunksOutput so ProcessImages (which
      // reads this off ProcessRows' input, not off the job row) receives it.
      // Nothing between here and there ever read job.zipS3Path itself.
      zipKey: job.zipS3Path,
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
