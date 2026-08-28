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

@Controller('notifications')
@UseGuards(InternalServiceGuard)
export class NotificationsController {
  private readonly logger = new Logger(
    NotificationsController.name,
  );

  constructor(
    private readonly publisher: SqsPublisher,
  ) {}

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  async createEvent(
    @Body() dto: CreateNotificationEventDto,
  ) {
    this.logger.log(
      `Received notification event: type=${dto.type}, key=${dto.idempotencyKey}`,
    );

    await this.publisher.publish(dto);

    this.logger.log(
      `Notification event queued successfully: key=${dto.idempotencyKey}`,
    );

    return {
      queued: true,
      idempotencyKey: dto.idempotencyKey,
    };
  }
}