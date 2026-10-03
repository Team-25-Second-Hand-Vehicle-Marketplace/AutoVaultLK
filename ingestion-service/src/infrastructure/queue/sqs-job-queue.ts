import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobQueue, UploadJobMessage } from '../ports/job-queue.port';

@Injectable()
export class SqsJobQueue implements JobQueue {
  private readonly logger = new Logger(SqsJobQueue.name);
  private readonly client: SQSClient;
  private readonly queueUrl: string;

  constructor(config: ConfigService) {
    const queueUrl = config.get<string>('INGESTION_SQS_QUEUE_URL')?.trim();
    if (!queueUrl) {
      // At construction rather than on first publish: a service that starts,
      // stores an upload and only then finds it cannot trigger the pipeline
      // has already answered 202 to the dealer.
      throw new Error(
        'INGESTION_SQS_QUEUE_URL must be set when INGESTION_QUEUE_DRIVER=sqs',
      );
    }

    this.queueUrl = queueUrl;
    this.client = new SQSClient({ region: config.get<string>('AWS_REGION') });

    this.logger.log(`SQS job queue using ${redactQueueUrl(this.queueUrl)}`);
  }

  async publish(message: UploadJobMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        // MessageGroupId / MessageDeduplicationId are omitted: the queue is a
        // standard queue, not FIFO. Ordering does not matter - each message is
        // an independent job - and idempotency is handled by the pipeline's
        // succeededChunks skip rather than by the queue.
      }),
    );
  }
}

/** Queue URLs embed the AWS account id; keep it out of the logs. */
function redactQueueUrl(url: string): string {
  return url.replace(/\/\d{12}\//, '/***/');
}
