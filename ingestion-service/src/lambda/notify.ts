import { runNotifyStage } from '../workers/etl-worker/pipeline/notify/notify.stage';
import type { AggregateOutput } from './aggregate-results';
import { getContext } from './bootstrap';

export type NotifyOutput = AggregateOutput & {
  notified: boolean;
};

/**
 * Step Functions state: Notify. Tells the dealer their upload finished.
 *
 * **Never throws.** Every row is already in marketplace.vehicles by the time
 * this runs, so a notification-service outage must not fail the execution —
 * that would mark a successful upload FAILED and invite the dealer to upload
 * again, duplicating work that already landed. Failure is recorded as a
 * DEGRADED stage log carrying the reason, and the job's own status is left
 * exactly as Aggregate set it.
 *
 * Passes its input through so the execution's final output stays the
 * aggregate's verdict rather than this stage's.
 */
export const handler = async (input: AggregateOutput): Promise<NotifyOutput> => {
  const ctx = await getContext();
  const log = ctx.stageLogs.forJob(input.jobId);
  const logId = await log.start('NOTIFY', null);

  try {
    // dealer_id and file_name live on the job row, not in the ASL payload:
    // threading them through every state would be four more fields carried
    // across six boundaries for one stage's benefit.
    const job = await ctx.uploadJobs.findById(input.jobId);

    if (!job) {
      await log.finish(logId, 'DEGRADED', {
        errorMessage: `Upload job ${input.jobId} not found`,
      });
      return { ...input, notified: false };
    }

    const result = await runNotifyStage({
      jobId: input.jobId,
      dealerId: job.dealerId,
      fileName: job.fileName,
      status: input.status,
      validRecords: input.validRecords,
      invalidRecords: input.invalidRecords,
    });

    await log.finish(logId, result.outcome, {
      metrics: result.metrics,
      errorMessage: result.error,
    });

    return { ...input, notified: result.metrics.sent };
  } catch (err) {
    // Reaching here means something outside the client failed — a database
    // read, most likely. Still not a reason to fail the execution.
    await log
      .finish(logId, 'DEGRADED', {
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .catch(() => undefined);

    return { ...input, notified: false };
  }
};
