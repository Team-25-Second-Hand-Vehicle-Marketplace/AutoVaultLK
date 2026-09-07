import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JOB_QUEUE } from '../ports/job-queue.port';
import { InProcessJobQueue } from './in-process-job-queue';

/**
 * Selects the JobQueue driver from INGESTION_QUEUE_DRIVER. Same fail-loud
 * posture as StorageModule: `sqs` throws rather than quietly running the
 * pipeline in-process on a deployed instance.
 *
 * InProcessJobQueue is also exported as a concrete class so the ETL module can
 * call setHandler on the very same instance the JOB_QUEUE token resolves to.
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
            throw new Error(
              'INGESTION_QUEUE_DRIVER=sqs is not implemented yet (ADR-007). ' +
                'Add SqsJobQueue alongside InProcessJobQueue and register it here.',
            );
          default:
            throw new Error(`Unknown INGESTION_QUEUE_DRIVER: ${driver}`);
        }
      },
    },
  ],
  exports: [JOB_QUEUE, InProcessJobQueue],
})
export class QueueModule {}
