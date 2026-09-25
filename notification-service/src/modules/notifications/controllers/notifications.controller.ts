import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';

import { InternalServiceGuard } from '../../../common/guards/internal-service.guard';
import { SqsPublisher } from '../../../infrastructure/aws/sqs/sqs.publisher';
import { CreateNotificationEventDto } from '../dto/create-notification-event.dto';
import { NotificationEventHandler } from '../services/notification-event.handler';

@Controller('notifications')
@UseGuards(InternalServiceGuard)
export class NotificationsController {
  private readonly logger = new Logger(
    NotificationsController.name,
  );

  constructor(
    private readonly publisher: SqsPublisher,
    private readonly handler: NotificationEventHandler,
  ) {}

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  async createEvent(
    @Body() dto: CreateNotificationEventDto,
  ) {
    this.logger.log(
      `Received notification event: type=${dto.type}, key=${dto.idempotencyKey}`,
    );

    if (this.publisher.isConfigured()) {
      await this.publisher.publish(dto);

      this.logger.log(
        `Notification event queued successfully: key=${dto.idempotencyKey}`,
      );

      return {
        queued: true,
        idempotencyKey: dto.idempotencyKey,
      };
    }

    // No queue configured (the current Lambda deployment): deliver in-request.
    // The Lambda freezes between invocations, so an in-process queue consumer
    // would never run reliably. NotificationEventHandler is idempotent per key
    // and schedules transient failures for the retry sweeper, so a caller that
    // times out and retries cannot cause a double send.
    const row = await this.handler.handle(dto);

    this.logger.log(
      `Notification event handled synchronously: key=${dto.idempotencyKey}, status=${row.status}`,
    );

    return {
      queued: false,
      status: row.status,
      idempotencyKey: dto.idempotencyKey,
    };
  }
}