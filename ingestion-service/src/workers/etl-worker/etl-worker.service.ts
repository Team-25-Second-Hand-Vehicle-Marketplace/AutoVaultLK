import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InProcessJobQueue } from '../../infrastructure/queue/in-process-job-queue';
import { UploadJobRepository } from '../../modules/ingestion/repositories/upload-job.repository';
import { LocalOrchestrator } from './local-orchestrator';

/**
 * Connects the job queue to the pipeline at boot.
 *
 * Replaces QueueBootstrapService, which marked every job FAILED while the
 * pipeline did not exist. Registration happens at the same point, on the same
 * queue instance — deliberately, so the swap changed one handler and nothing
 * about the surrounding wiring.
 *
 * Under SQS this becomes a consumer loop and under Step Functions the queue
 * message starts an execution instead; both call the same orchestrator.
 */
@Injectable()
export class EtlWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EtlWorkerService.name);

  constructor(
    private readonly queue: InProcessJobQueue,
    private readonly orchestrator: LocalOrchestrator,
    private readonly uploadJobs: UploadJobRepository,
  ) {}

  onApplicationBootstrap(): void {
    this.queue.setHandler(async ({ jobId }) => {
      try {
        await this.orchestrator.run(jobId);
      } catch (err) {
        // The orchestrator handles its own failures, so reaching here means
        // something escaped it. The job must not be left PROCESSING forever —
        // a dealer polling GET /jobs/{id} would wait on a status that never
        // arrives.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Unhandled pipeline error for job ${jobId}: ${message}`);
        await this.uploadJobs.updateStatus(jobId, 'FAILED').catch(() => {
          this.logger.error(`Could not mark job ${jobId} FAILED`);
        });
      }
    });

    this.logger.log('ETL pipeline handler registered');
  }
}
