import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { ListingService } from '../services/listing.service';
import { CreateListingDto } from '../dto/create-listing.dto';
import { MyListingsQueryDto } from '../dto/my-listings-query.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';

@Controller('listings')
export class ListingController {
  constructor(private readonly listingService: ListingService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER', 'ADMIN')
  createListing(
    @Body() dto: CreateListingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.listingService.createListing(dto, actor);
  }

  @Get()
  getAllListings() {
    return this.listingService.getAllListings();
  }

  // Must stay ahead of `:id` — otherwise Nest matches "mine" as an id param.
  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER')
  getMyListings(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: MyListingsQueryDto,
  ) {
    return this.listingService.getMyListings(actor, query.sort);
  }

  @Get(':id')
  getListingById(@Param('id', ParseUUIDPipe) id: string) {
    return this.listingService.getListingById(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER', 'ADMIN')
  updateListing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.listingService.updateListing(id, dto, actor);
  }

  @Patch(':id/deactivate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER', 'ADMIN')
  deactivateListing(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.listingService.deactivateListing(id, actor);
  }

  /**
   * FR-42: the dealer's explicit approval that publishes a PENDING_REVIEW
   * listing. See ListingService.approveListing for why a wrong-status
   * listing is a 409 rather than the ownership-check's 404.
   */
  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER', 'ADMIN')
  approveListing(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.listingService.approveListing(id, actor);
  }
}
