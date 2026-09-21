import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../../infrastructure/database/entities/notification.entity';
import { AuthUserView } from '../../infrastructure/database/entities/auth-user.view-entity';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard';
import { SqsPublisher } from '../../infrastructure/aws/sqs/sqs.publisher';
import { SesAdapter } from './adapters/ses.adapter';
import { NotificationsController } from './controllers/notifications.controller';
import { NotificationsRepository } from './repositories/notifications.repository';
import { EmailTemplateService } from './services/email-template.service';
import { NotificationEventHandler } from './services/notification-event.handler';
import { NotificationRetrySweeper } from './services/notification-retry.sweeper';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, AuthUserView])],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    EmailTemplateService,
    SesAdapter,
    NotificationEventHandler,
    NotificationRetrySweeper,
    SqsPublisher,
    InternalServiceGuard,
  ],

  exports: [NotificationEventHandler],
})
export class NotificationsModule {}
