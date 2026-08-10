import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ResourceOwner } from '../../auth/decorators/resource-owner.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ResourceOwnerGuard } from '../../auth/guards/resource-owner.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { CreateDealerProfileDto } from '../dto/create-dealer-profile.dto';
import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';
import { DealerProfilesService } from '../services/dealer-profiles.service';

@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnerGuard)
@Controller('dealer-profiles')
export class DealerProfilesController {
  constructor(
    private readonly dealerProfilesService: DealerProfilesService,
  ) {}

  @Get('me')
  @Roles('DEALER')
  getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.dealerProfilesService.findByUserId(user.id);
  }

  @Get()
  @Roles('ADMIN')
  findAll() {
    return this.dealerProfilesService.findAll();
  }

  @Get(':userId')
  @Roles('DEALER', 'ADMIN')
  @ResourceOwner('userId')
  findByUserId(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.dealerProfilesService.findByUserId(userId);
  }

  @Post()
  @Roles('DEALER')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() data: CreateDealerProfileDto,
  ) {
    if (data.userId !== user.id) {
      throw new ForbiddenException(
        'Dealers can only create a profile for their own account',
      );
    }

    return this.dealerProfilesService.create(data);
  }

  @Patch(':userId')
  @Roles('DEALER', 'ADMIN')
  @ResourceOwner('userId')
  update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() data: UpdateDealerProfileDto,
  ) {
    return this.dealerProfilesService.update(userId, data);
  }
}
