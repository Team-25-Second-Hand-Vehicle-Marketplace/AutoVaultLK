import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { SecurityEvent } from '../../../infrastructure/database/entities/security-event.entity';
import type { SecurityEventType } from '../constants/auth-security.constants';

export type RecordSecurityEventInput = {
  eventType: SecurityEventType;
  email?: string | null;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success: boolean;
  failureReason?: string | null;
};

@Injectable()
export class SecurityEventsRepository {
  constructor(
    @InjectRepository(SecurityEvent)
    private readonly repository: Repository<SecurityEvent>,
  ) {}

  record(input: RecordSecurityEventInput) {
    return this.repository.save(
      this.repository.create({
        eventType: input.eventType,
        email: input.email ?? null,
        userId: input.userId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        success: input.success,
        failureReason: input.failureReason ?? null,
      }),
    );
  }

  countRecentByIp(
    eventType: SecurityEventType,
    ipAddress: string | null | undefined,
    since: Date,
    success = false,
  ) {
    if (!ipAddress) {
      return Promise.resolve(0);
    }

    return this.repository.count({
      where: {
        eventType,
        ipAddress,
        success,
        createdAt: MoreThan(since),
      },
    });
  }

  countRecentByEmail(
    eventType: SecurityEventType,
    email: string,
    since: Date,
    success = false,
  ) {
    return this.repository.count({
      where: {
        eventType,
        email,
        success,
        createdAt: MoreThan(since),
      },
    });
  }

  countRecentFailuresByEmail(
    eventTypes: SecurityEventType[],
    email: string,
    since: Date,
  ) {
    return this.repository
      .createQueryBuilder('event')
      .where('event.email = :email', { email })
      .andWhere('event.success = false')
      .andWhere('event.created_at > :since', { since })
      .andWhere('event.event_type IN (:...eventTypes)', { eventTypes })
      .getCount();
  }
}
