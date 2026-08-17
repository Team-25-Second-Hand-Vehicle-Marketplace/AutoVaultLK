import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationEventHandler } from '../../../modules/notifications/services/notification-event.handler';
import type { CreateNotificationEventDto } from '../../../modules/notifications/dto/create-notification-event.dto';

const supportedTypes = [
  'UPLOAD_COMPLETED',
  'UPLOAD_FAILED',
  'DEALER_VERIFIED',
  'DEALER_REJECTED',
];

@Injectable()
export class SqsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumer.name);

  private readonly client: SQSClient;
  private readonly queueUrl: string;

  private running = true;

  constructor(
    private readonly config: ConfigService,
    private readonly handler: NotificationEventHandler,
  ) {
    this.client = new SQSClient({
      region: this.config.get<string>('AWS_REGION') ?? 'ap-southeast-1',
    });

    this.queueUrl =
      this.config.get<string>('NOTIFICATION_SQS_QUEUE_URL') ?? '';
  }

  async onModuleInit() {
    if (!this.queueUrl) {
      this.logger.warn(
        'NOTIFICATION_SQS_QUEUE_URL is not configured. SQS consumer disabled.',
      );
      return;
    }

    this.logger.log(`Starting SQS consumer: ${this.queueUrl}`);

    void this.consume();
  }

  async onModuleDestroy() {
    this.running = false;
  }

  private async consume(): Promise<void> {
    while (this.running) {
      try {
        const response = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20,
            VisibilityTimeout: 60,
          }),
        );

        const messages = response.Messages ?? [];

        for (const message of messages) {
          await this.processMessage(message);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        this.logger.error(`SQS polling failed: ${message}`);

        // Prevent a tight retry loop if SQS is unavailable.
        await this.sleep(5000);
      }
    }
  }

  private async processMessage(message: {
    MessageId?: string;
    ReceiptHandle?: string;
    Body?: string;
  }): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) {
      this.logger.warn('Received invalid SQS message');
      return;
    }

    try {
      const event = JSON.parse(message.Body) as CreateNotificationEventDto;

      if (!supportedTypes.includes(event.type)) {
        this.logger.warn(`Ignoring unsupported event type: ${event.type}`);

        await this.deleteMessage(message.ReceiptHandle);
        return;
}
      this.logger.log(
        `Processing notification event ${event.type}, key=${event.idempotencyKey}`,
      );

      await this.handler.handle(event);

      await this.deleteMessage(message.ReceiptHandle);

      this.logger.log(
        `Processed notification event ${event.idempotencyKey}`,
      );
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Notification event processing failed: ${messageText}`);

      /*
       * IMPORTANT:
       * Do NOT delete the message when processing fails.
       *
       * SQS will make the message visible again after the
       * visibility timeout and retry it.
       */
    }
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}