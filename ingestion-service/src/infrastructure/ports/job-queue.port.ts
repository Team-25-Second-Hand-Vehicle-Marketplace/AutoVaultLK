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

/** DI token - `JobQueue` is an interface and erases at runtime. */
export const JOB_QUEUE = Symbol('JobQueue');
