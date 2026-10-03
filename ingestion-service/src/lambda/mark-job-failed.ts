import { getContext } from './bootstrap';

export type MarkJobFailedInput = {
  jobId: string;
  /** Whatever ASL caught, placed at $.error by the failing state's Catch. */
  error?: { Error?: string; Cause?: string };
};

export const handler = async (input: MarkJobFailedInput): Promise<{ jobId: string }> => {
  const ctx = await getContext();

  await ctx.uploadJobs.updateStatus(input.jobId, 'FAILED');

  // The cause carries the original error message, which is usually the only
  // record of WHY outside CloudWatch. Written to the stage log rather than the
  // job row: upload_jobs has no error column, and rejected_records is for row
  // defects the dealer can act on, not infrastructure failures they cannot.
  const log = ctx.stageLogs.forJob(input.jobId);
  const logId = await log.start('AGGREGATE', null);
  await log.finish(logId, 'FAILED', {
    errorMessage: describe(input.error),
  });

  return { jobId: input.jobId };
};

/**
 * ASL wraps a Lambda failure as { Error, Cause } where Cause is a JSON string
 * carrying errorMessage. Unwrapping it turns "an execution failed" into the
 * actual message; falling back to the raw cause keeps the handler total when
 * the shape is something else.
 */
function describe(error: MarkJobFailedInput['error']): string {
  if (!error) return 'Execution failed with no error detail';

  if (error.Cause) {
    try {
      const parsed = JSON.parse(error.Cause) as { errorMessage?: string };
      if (parsed.errorMessage) return `${error.Error ?? 'Error'}: ${parsed.errorMessage}`;
    } catch {
      // Not JSON - a States.* error puts a plain string here.
    }
    return `${error.Error ?? 'Error'}: ${error.Cause}`;
  }

  return error.Error ?? 'Execution failed';
}
