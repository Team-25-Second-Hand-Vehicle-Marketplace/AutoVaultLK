import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AuditLogsQueryDto } from '../dto/audit-logs-query.dto';
import { ListUploadsQueryDto } from '../dto/list-uploads-query.dto';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { ReportsQueryDto } from '../dto/reports-query.dto';
import { AdminReadsService } from '../services/admin-reads.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly reads: AdminReadsService) {}

  @Get('dashboard')
  dashboard() {
    return this.reads.dashboard();
  }

  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.reads.listUsers(query.verificationStatus);
  }

  @Get('uploads')
  listUploads(@Query() query: ListUploadsQueryDto) {
    return this.reads.listUploads(query.status);
  }

  @Get('reports')
  reports(@Query() query: ReportsQueryDto) {
    return this.reads.reports(query.from, query.to);
  }

  @Get('audit-logs')
  auditLogs(@Query() query: AuditLogsQueryDto) {
    return this.reads.auditLogsSearch(query);
  }
}
