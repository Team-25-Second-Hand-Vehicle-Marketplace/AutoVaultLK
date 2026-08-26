import {
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type NotificationEvent = {
  type:
    | 'UPLOAD_COMPLETED'
    | 'UPLOAD_FAILED'
    | 'DEALER_VERIFIED'
    | 'DEALER_REJECTED';

  userId: string;

  idempotencyKey: string;

  payload?: Record<string, unknown>;
};

@Injectable()
export class SqsPublisher {
  private readonly logger = new Logger(SqsPublisher.name);

  private readonly client: SQSClient;
  private readonly queueUrl: string;

  constructor(private readonly config: ConfigService) {
    this.client = new SQSClient({
      region:
        this.config.get<string>('AWS_REGION') ??
        'ap-southeast-1',

      endpoint:
        this.config.get<string>('AWS_SQS_ENDPOINT') ||
        undefined,
    });

    this.queueUrl =
      this.config.get<string>(
        'NOTIFICATION_SQS_QUEUE_URL',
      ) ?? '';
  }

  async publish(event: NotificationEvent): Promise<void> {
    if (!this.queueUrl) {
      throw new Error(
        'NOTIFICATION_SQS_QUEUE_URL is not configured',
      );
    }

    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(event),
      }),
    );

    this.logger.log(
      `Published notification event ${event.type}, key=${event.idempotencyKey}`,
    );
  }
}