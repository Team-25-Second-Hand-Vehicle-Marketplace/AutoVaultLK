import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import type { UploadJobMessage } from '../infrastructure/ports/job-queue.port';
import { UploadJobRepository } from '../modules/ingestion/repositories/upload-job.repository';
import { LocalOrchestrator } from '../workers/etl-worker/local-orchestrator';

/**
 * SQS-triggered stand-in for the Step Functions state machine (§8's minimal
 * deployment path — see production/README.md).
 *
 * The full design is one Lambda per pipeline stage, fanned out by Step
 * Functions. That is not built yet. This runs the exact same
 * `LocalOrchestrator` the local/Docker path and every unit test already
 * exercise, inside one Lambda invocation per job instead of per stage — same
 * code, different executor, matching ADR-007's own framing of
 * LocalOrchestrator as "standing in for Step Functions."
 *
 * Batch size is 1 (see the event source mapping in Terraform): a job's
 * pipeline already fans out internally via mapWithConcurrency, so batching
 * multiple jobs into one invocation would only complicate the 15-minute
 * Lambda timeout budget for no benefit.
 */

const logger = new Logger('EtlWorkerLambda');

let cached: INestApplicationContext;

async function bootstrap(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(AppModule);
}

type SqsRecord = { messageId: string; body: string };
type SqsEvent = { Records: SqsRecord[] };

export async function handler(event: SqsEvent): Promise<void> {
  cached ??= await bootstrap();

  const orchestrator = cached.get(LocalOrchestrator);
  const uploadJobs = cached.get(UploadJobRepository);

  for (const record of event.Records) {
    const { jobId } = JSON.parse(record.body) as UploadJobMessage;

    try {
      await orchestrator.run(jobId);
    } catch (err) {
      // LocalOrchestrator already handles per-chunk and per-stage failure
      // internally (PARTIAL/FAILED). Reaching here means something escaped
      // it — mirror EtlWorkerService's same last-resort handling so a dealer
      // polling GET /jobs/{id} does not wait on a status that never arrives.
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Unhandled pipeline error for job ${jobId}: ${message}`);
      await uploadJobs.updateStatus(jobId, 'FAILED').catch(() => {
        logger.error(`Could not mark job ${jobId} FAILED`);
      });
    }
  }
}
