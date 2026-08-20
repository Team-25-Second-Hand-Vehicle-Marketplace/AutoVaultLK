import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { InternalServiceGuard } from '../../../common/guards/internal-service.guard';
import { CreateAdminUserDto } from '../dto/create-admin-user.dto';
import { DeactivateUserDto } from '../dto/deactivate-user.dto';
import { UsersService } from '../services/users.service';

/**
 * East-west routes for admin-service (internal-api.yaml / ADR-005).
 * Not on the public nginx listener. Requires X-Internal-Service-Key.
 */
@Controller('internal/users')
@UseGuards(InternalServiceGuard)
export class InternalUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post(':id/deactivate')
  deactivate(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: DeactivateUserDto,
  ) {
    return this.usersService.deactivate(userId, dto.adminId);
  }

  @Post(':id/reactivate')
  reactivate(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: DeactivateUserDto,
  ) {
    return this.usersService.reactivate(userId, dto.adminId);
  }

  // Declared before ':id/...' would matter only for a same-shape path; 'admin'
  // is a distinct single segment under /internal/users, so there is no clash.
  @Post('admin')
  createAdmin(@Body() dto: CreateAdminUserDto) {
    return this.usersService.createAdmin(
      { email: dto.email, name: dto.name, password: dto.password },
      dto.adminId,
    );
  }
}
