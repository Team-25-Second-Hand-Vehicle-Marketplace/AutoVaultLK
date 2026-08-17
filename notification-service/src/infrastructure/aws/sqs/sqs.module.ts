import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../../modules/notifications/notifications.module';
import { SqsConsumer } from './sqs.consumer';

@Module({
  imports: [NotificationsModule],
  providers: [SqsConsumer],
})
export class SqsModule {}