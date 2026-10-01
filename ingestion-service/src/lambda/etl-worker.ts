import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import type { UploadJobMessage } from '../infrastructure/ports/job-queue.port';
import { UploadJobRepository } from '../modules/ingestion/repositories/upload-job.repository';
import { LocalOrchestrator } from '../workers/etl-worker/local-orchestrator';


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
      // it - mirror EtlWorkerService's same last-resort handling so a dealer
      // polling GET /jobs/{id} does not wait on a status that never arrives.
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Unhandled pipeline error for job ${jobId}: ${message}`);
      await uploadJobs.updateStatus(jobId, 'FAILED').catch(() => {
        logger.error(`Could not mark job ${jobId} FAILED`);
      });
    }
  }
}
