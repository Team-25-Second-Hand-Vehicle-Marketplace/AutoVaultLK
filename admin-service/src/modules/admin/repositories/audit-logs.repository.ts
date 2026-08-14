import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../../infrastructure/database/entities/audit-log.entity';

export type AuditLogFilters = {
  action?: string;
  entityType?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
};

export type NewAuditLog = {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes: Record<string, unknown>;
  ipAddress: string | null;
};

@Injectable()
export class AuditLogsRepository {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogs: Repository<AuditLog>,
  ) {}

  append(data: NewAuditLog) {
    return this.auditLogs.save(this.auditLogs.create(data));
  }

  search(filters: AuditLogFilters) {
    const qb = this.auditLogs.createQueryBuilder('a').orderBy('a.createdAt', 'DESC').take(200);

    if (filters.action) {
      qb.andWhere('a.action = :action', { action: filters.action });
    }
    if (filters.entityType) {
      qb.andWhere('a.entityType = :entityType', { entityType: filters.entityType });
    }
    if (filters.actorId) {
      qb.andWhere('a.actorId = :actorId', { actorId: filters.actorId });
    }
    if (filters.from) {
      qb.andWhere('a.createdAt >= :from', { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere('a.createdAt <= :to', { to: filters.to });
    }

    return qb.getMany();
  }
}
