import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InProcessJobQueue } from '../../infrastructure/queue/in-process-job-queue';
import { UploadJobRepository } from './repositories/upload-job.repository';

/**
 * Registers a placeholder pipeline handler at boot.
 *
 * InProcessJobQueue.publish() throws when nothing is registered — deliberately,
 * because a dropped trigger would otherwise look exactly like a successful
 * upload. But the orchestrator does not exist yet (Phase A), so without this
 * the very first POST /ingest/upload would 500 and the upload API could not be
 * developed or demoed at all.
 *
 * The placeholder marks the job FAILED with a loud warning rather than leaving
 * it PENDING forever, so the state is honest: the upload was accepted, and
 * nothing processed it.
 *
 * REPLACE THIS when LocalOrchestrator lands (plan §A8): swap the handler for
 * `(msg) => orchestrator.run(msg.jobId)` and delete this file. The parity is
 * intentional — same registration point, same instance.
 */
@Injectable()
export class QueueBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueueBootstrapService.name);

  constructor(
    private readonly queue: InProcessJobQueue,
    private readonly uploadJobs: UploadJobRepository,
  ) {}

  onApplicationBootstrap(): void {
    this.queue.setHandler(async ({ jobId }) => {
      this.logger.warn(
        `No ETL pipeline is wired yet — marking upload job ${jobId} FAILED. ` +
          'Replace QueueBootstrapService with LocalOrchestrator (plan §A8).',
      );
      await this.uploadJobs.updateStatus(jobId, 'FAILED');
    });

    this.logger.warn(
      'Placeholder ETL handler registered: uploads are accepted and immediately ' +
        'marked FAILED until the pipeline lands.',
    );
  }
}
