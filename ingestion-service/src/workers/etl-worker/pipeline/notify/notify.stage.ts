import {
  emit,
  isNotificationConfigured,
  type NotificationEventType,
} from './notification-client';

export type NotifyOutcome = 'SUCCEEDED' | 'SKIPPED' | 'DEGRADED';

export type NotifyInput = {
  jobId: string;
  /** auth.users id of the owning dealer, taken from the job row. */
  dealerId: string;
  fileName: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  validRecords: number;
  invalidRecords: number;
};

export type NotifyResult = {
  outcome: NotifyOutcome;
  metrics: { type: NotificationEventType | null; sent: boolean };
  error?: string;
};

/**
 * Tells the dealer their upload finished.
 *
 * Runs last, after every row is already in marketplace.vehicles, and that
 * ordering is what licenses its failure posture: **an unreachable notification
 * service must not fail the job.** Doing so would turn a successful upload into
 * a FAILED one and invite the dealer to re-upload work that already landed.
 * Failure is recorded as DEGRADED, which the stage log carries with a reason.
 *
 * Not a StageRunner: it operates on one job, not on a chunk of rows, and it
 * produces no rows for a next stage. Same shape as the aggregate handler,
 * which it follows in the graph.
 */
export async function runNotifyStage(input: NotifyInput): Promise<NotifyResult> {
  // No key is the normal local and CI state — the pipeline is working as
  // designed, so this is SKIPPED rather than a warning.
  if (!isNotificationConfigured()) {
    return { outcome: 'SKIPPED', metrics: { type: null, sent: false } };
  }

  const type = eventTypeFor(input.status);

  const result = await emit({
    type,
    userId: input.dealerId,
    // Deterministic, and unique per job per outcome. notification-service
    // dedupes on it, so a Step Functions retry of this stage re-sends the same
    // key rather than mailing the dealer twice.
    idempotencyKey: `upload-${input.status.toLowerCase()}-${input.jobId}`,
    payload: {
      jobId: input.jobId,
      fileName: input.fileName,
      status: input.status,
      validRecords: input.validRecords,
      invalidRecords: input.invalidRecords,
      // The template needs to say more than a count: PARTIAL is a success with
      // skipped rows, and a dealer who reads it as a failure re-uploads the
      // whole file.
      summary: summaryFor(input),
    },
  });

  if (!result.sent) {
    return {
      outcome: 'DEGRADED',
      metrics: { type, sent: false },
      error: result.reason,
    };
  }

  return { outcome: 'SUCCEEDED', metrics: { type, sent: true } };
}

/**
 * PARTIAL maps to UPLOAD_COMPLETED, not UPLOAD_FAILED.
 *
 * The intake vocabulary has only the two, and a job that loaded most of its
 * rows is far closer to completed than to failed — the counts in the payload
 * carry the nuance. Mapping it to UPLOAD_FAILED would tell a dealer whose 34
 * of 40 rows loaded that nothing worked.
 */
function eventTypeFor(status: NotifyInput['status']): NotificationEventType {
  return status === 'FAILED' ? 'UPLOAD_FAILED' : 'UPLOAD_COMPLETED';
}

function summaryFor(input: NotifyInput): string {
  const { status, validRecords, invalidRecords, fileName } = input;

  if (status === 'FAILED') {
    return `We could not process ${fileName}. No listings were created.`;
  }

  const listings = `${validRecords} listing${validRecords === 1 ? '' : 's'}`;

  if (status === 'PARTIAL') {
    return (
      `${listings} from ${fileName} were created and are awaiting review. ` +
      `${invalidRecords} row${invalidRecords === 1 ? ' was' : 's were'} skipped — ` +
      'check the upload page for the reasons.'
    );
  }

  return `${listings} from ${fileName} were created and are awaiting review.`;
}
