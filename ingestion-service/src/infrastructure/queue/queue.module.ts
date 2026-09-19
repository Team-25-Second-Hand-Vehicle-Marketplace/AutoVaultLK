import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JOB_QUEUE } from '../ports/job-queue.port';
import { InProcessJobQueue } from './in-process-job-queue';
import { SqsJobQueue } from './sqs-job-queue';

/**
 * Selects the JobQueue driver from INGESTION_QUEUE_DRIVER. Same fail-loud
 * posture as StorageModule: an unknown driver throws rather than quietly
 * running the pipeline in-process on a deployed instance.
 *
 * InProcessJobQueue is also exported as a concrete class so the ETL module can
 * call setHandler on the very same instance the JOB_QUEUE token resolves to.
 * SqsJobQueue has no setHandler — under `sqs` the queue is consumed by Step
 * Functions, not by this process — so EtlWorkerService must not register a
 * handler in that mode. It checks the driver before wiring itself up.
 */
@Global()
@Module({
  providers: [
    InProcessJobQueue,
    {
      provide: JOB_QUEUE,
      inject: [ConfigService, InProcessJobQueue],
      useFactory: (config: ConfigService, inProcess: InProcessJobQueue) => {
        const driver = config.get<string>('INGESTION_QUEUE_DRIVER') ?? 'inprocess';

        switch (driver) {
          case 'inprocess':
            return inProcess;
          case 'sqs':
            return new SqsJobQueue(config);
          default:
            throw new Error(`Unknown INGESTION_QUEUE_DRIVER: ${driver}`);
        }
      },
    },
  ],
  exports: [JOB_QUEUE, InProcessJobQueue],
})
export class QueueModule {}
