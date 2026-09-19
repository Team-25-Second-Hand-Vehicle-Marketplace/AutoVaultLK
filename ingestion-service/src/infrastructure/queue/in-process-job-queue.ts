import { Injectable, Logger } from '@nestjs/common';
import type { JobQueue, UploadJobMessage } from '../ports/job-queue.port';

/**
 * Stands in for SQS → Step Functions locally (ADR-007). publish() hands the job
 * to the orchestrator on the next tick and returns immediately, so
 * POST /ingest/upload can answer 202 without waiting for the ETL run.
 *
 * The handler is registered after construction rather than injected: the
 * orchestrator depends on repositories that themselves sit downstream of this
 * module, and setHandler breaks that cycle without threading a forwardRef
 * through the whole graph.
 */
@Injectable()
export class InProcessJobQueue implements JobQueue {
  private readonly logger = new Logger(InProcessJobQueue.name);
  private handler?: (message: UploadJobMessage) => Promise<void>;

  setHandler(handler: (message: UploadJobMessage) => Promise<void>): void {
    this.handler = handler;
  }

  publish(message: UploadJobMessage): Promise<void> {
    if (!this.handler) {
      // A dropped trigger would look exactly like a successful upload: 202
      // returned, job row PENDING forever. Fail the request instead.
      throw new Error(
        'InProcessJobQueue has no handler registered — the ETL module did not wire itself up',
      );
    }

    const handler = this.handler;

    setImmediate(() => {
      void handler(message).catch((err: unknown) => {
        // The orchestrator marks the job FAILED internally; this catch exists
        // only so an unhandled rejection cannot take down the HTTP process
        // that is still serving GET /jobs/{id} polls for other dealers.
        const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
        this.logger.error(`ETL run for job ${message.jobId} threw: ${detail}`);
      });
    });

    return Promise.resolve();
  }
}
