import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { AuditLogsQueryDto } from '../dto/audit-logs-query.dto';
import { CreateAdminDto } from '../dto/create-admin.dto';
import { ListUploadsQueryDto } from '../dto/list-uploads-query.dto';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { RejectDealerDto } from '../dto/reject-dealer.dto';
import { ReportsQueryDto } from '../dto/reports-query.dto';
import { AdminMutationsService } from '../services/admin-mutations.service';
import { AdminReadsService } from '../services/admin-reads.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly reads: AdminReadsService,
    private readonly mutations: AdminMutationsService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.reads.dashboard();
  }

  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.reads.listUsers(query.verificationStatus);
  }

  @Get('dealers/:id')
  findDealer(@Param('id', ParseUUIDPipe) userId: string) {
    return this.reads.findDealer(userId);
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

  @Post('dealers/:id/approve')
  approveDealer(
    @Param('id', ParseUUIDPipe) dealerId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.mutations.approveDealer(dealerId, actor, requestIp(req));
  }

  @Post('dealers/:id/reject')
  rejectDealer(
    @Param('id', ParseUUIDPipe) dealerId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
    @Body() body: RejectDealerDto,
  ) {
    return this.mutations.rejectDealer(dealerId, actor, requestIp(req), body?.reason);
  }

  @Post('users/:id/deactivate')
  deactivateUser(
    @Param('id', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.mutations.deactivateUser(userId, actor, requestIp(req));
  }

  @Post('users/:id/reactivate')
  reactivateUser(
    @Param('id', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.mutations.reactivateUser(userId, actor, requestIp(req));
  }

  @Post('users')
  createAdmin(
    @Body() body: CreateAdminDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.mutations.createAdmin(body, actor, requestIp(req));
  }
}

function requestIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const raw =
    typeof forwarded === 'string' && forwarded.length > 0
      ? forwarded.split(',')[0]
      : req.ip;
  const trimmed = raw?.trim();
  return trimmed || null;
}
