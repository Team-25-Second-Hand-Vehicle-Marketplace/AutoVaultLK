import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InternalServiceGuard } from '../../../common/guards/internal-service.guard';
import { CreateNotificationEventDto } from '../dto/create-notification-event.dto';
import { NotificationEventHandler } from '../services/notification-event.handler';

@Controller('notifications')
@UseGuards(InternalServiceGuard)
export class NotificationsController {
  constructor(private readonly handler: NotificationEventHandler) {}

  @Post('events')
  createEvent(@Body() dto: CreateNotificationEventDto) {
    return this.handler.handle(dto);
  }
}
