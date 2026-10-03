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

export async function runNotifyStage(input: NotifyInput): Promise<NotifyResult> {
  // No key is the normal local and CI state - the pipeline is working as
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
      `${invalidRecords} row${invalidRecords === 1 ? ' was' : 's were'} skipped - ` +
      'check the upload page for the reasons.'
    );
  }

  return `${listings} from ${fileName} were created and are awaiting review.`;
}
