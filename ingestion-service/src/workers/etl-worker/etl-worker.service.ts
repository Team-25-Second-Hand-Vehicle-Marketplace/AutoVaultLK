import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InProcessJobQueue } from '../../infrastructure/queue/in-process-job-queue';
import { UploadJobRepository } from '../../modules/ingestion/repositories/upload-job.repository';
import { LocalOrchestrator } from './local-orchestrator';

@Injectable()
export class EtlWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EtlWorkerService.name);

  constructor(
    private readonly queue: InProcessJobQueue,
    private readonly orchestrator: LocalOrchestrator,
    private readonly uploadJobs: UploadJobRepository,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const driver = this.config.get<string>('INGESTION_QUEUE_DRIVER') ?? 'inprocess';

    if (driver !== 'inprocess') {
      this.logger.log(
        `Queue driver is "${driver}" - Step Functions owns execution, ` +
          'not registering an in-process handler',
      );
      return;
    }

    this.queue.setHandler(async ({ jobId }) => {
      try {
        await this.orchestrator.run(jobId);
      } catch (err) {
        // The orchestrator handles its own failures, so reaching here means
        // something escaped it. The job must not be left PROCESSING forever -
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
