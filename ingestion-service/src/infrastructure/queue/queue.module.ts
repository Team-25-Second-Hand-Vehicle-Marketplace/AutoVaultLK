import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JOB_QUEUE } from '../ports/job-queue.port';
import { InProcessJobQueue } from './in-process-job-queue';
import { SqsJobQueue } from './sqs-job-queue';

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
