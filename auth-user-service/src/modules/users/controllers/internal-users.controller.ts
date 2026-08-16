import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { InternalServiceGuard } from '../../../common/guards/internal-service.guard';
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
}
