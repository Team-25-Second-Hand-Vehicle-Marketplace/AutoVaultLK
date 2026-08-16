import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../../infrastructure/database/entities/notification.entity';
import { AuthUserView } from '../../../infrastructure/database/entities/auth-user.view-entity';

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(AuthUserView)
    private readonly users: Repository<AuthUserView>,
  ) {}

  findByIdempotencyKey(key: string) {
    return this.notifications.findOne({ where: { idempotencyKey: key } });
  }

  findUser(userId: string) {
    return this.users.findOne({ where: { id: userId } });
  }

  createPending(data: {
    userId: string;
    type: Notification['type'];
    subject: string;
    message: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    return this.notifications.save(
      this.notifications.create({
        ...data,
        status: 'PENDING',
      }),
    );
  }

  markSent(id: string) {
    return this.notifications.update(id, { status: 'SENT', sentAt: new Date() });
  }

  markFailed(id: string) {
    return this.notifications.update(id, { status: 'FAILED' });
  }

  findById(id: string) {
    return this.notifications.findOne({ where: { id } });
  }
}
