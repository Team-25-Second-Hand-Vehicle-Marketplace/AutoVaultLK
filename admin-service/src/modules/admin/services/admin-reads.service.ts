import { BadRequestException, Injectable } from '@nestjs/common';
import { mapDashboard } from '../mappers/dashboard.mapper';
import { AdminReadsRepository } from '../repositories/admin-reads.repository';
import { AuditLogsRepository } from '../repositories/audit-logs.repository';
import type { AuditLogsQueryDto } from '../dto/audit-logs-query.dto';

@Injectable()
export class AdminReadsService {
  constructor(
    private readonly reads: AdminReadsRepository,
    private readonly auditLogs: AuditLogsRepository,
  ) {}

  async dashboard() {
    return mapDashboard(await this.reads.loadDashboardRaw());
  }

  listUsers(verificationStatus?: string) {
    return this.reads.listUsers(verificationStatus);
  }

  listUploads(status?: string) {
    return this.reads.listUploads(status);
  }

  reports(from: Date, to: Date) {
    if (from > to) {
      throw new BadRequestException('from must be on or before to');
    }
    return this.reads.loadReports(from, to);
  }

  auditLogsSearch(query: AuditLogsQueryDto) {
    return this.auditLogs.search(query);
  }
}
