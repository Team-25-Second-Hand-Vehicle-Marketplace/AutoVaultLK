/**
 * The buffer between the Ingest API and the ETL pipeline. Locally an
 * in-process dispatch; in AWS the SQS queue that starts a Step Functions
 * execution (SAD §6.2 step 2, ADR-007).
 *
 * publish() must resolve once the message is accepted, NOT once the pipeline
 * finishes: POST /ingest/upload answers 202 immediately and the dealer polls
 * GET /jobs/{id} for progress (FR-32).
 */
export interface JobQueue {
  publish(message: UploadJobMessage): Promise<void>;
}

/**
 * Deliberately just the id. The pipeline re-reads the job row rather than
 * trusting a payload, so a redelivered or replayed message cannot resurrect
 * stale field values.
 */
export type UploadJobMessage = {
  jobId: string;
};

/** DI token — `JobQueue` is an interface and erases at runtime. */
export const JOB_QUEUE = Symbol('JobQueue');
