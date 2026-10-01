import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { ListingService } from '../services/listing.service';
import { ApproveSelectedDto } from '../dto/approve-selected.dto';
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

  // Must stay ahead of `:id` - otherwise Nest matches "mine" as an id param.
  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER')
  getMyListings(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: MyListingsQueryDto,
  ) {
    return this.listingService.getMyListings(actor, query.sort);
  }

  /**
   * Approves every pending listing the dealer owns. Declared before the
   * `:id` routes so "approve-all" is not parsed as an id (and then rejected by
   * ParseUUIDPipe).
   */
  @Patch('approve-all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER')
  approveAllPending(@CurrentUser() actor: AuthenticatedUser) {
    return this.listingService.approveAllPending(actor);
  }

  /**
   * Approves the listed ids (the dealer's own, still pending). Declared before
   * the `:id` routes for the same reason as approve-all.
   */
  @Patch('approve-selected')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER')
  approveSelected(@CurrentUser() actor: AuthenticatedUser, @Body() dto: ApproveSelectedDto) {
    return this.listingService.approveSelected(actor, dto.ids);
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
   * Reverses deactivate. See ListingService.unarchiveListing for why a
   * non-ARCHIVED listing is a 409 rather than the ownership-check's 404.
   */
  @Patch(':id/unarchive')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER', 'ADMIN')
  unarchiveListing(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.listingService.unarchiveListing(id, actor);
  }

  /**
   * Permanently removes a listing - distinct from `deactivate`, which only
   * hides it. Only DRAFT/PENDING_REVIEW/REJECTED listings qualify; see
   * ListingService.deleteListing for why LIVE/SOLD/ARCHIVED are 409s here.
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER', 'ADMIN')
  deleteListing(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.listingService.deleteListing(id, actor);
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

  /**
   * FR-58: attaches photos to a listing the dealer (or admin) already owns.
   * Replaces the whole image set - see ListingService.uploadImages for why.
   *
   * Multer's memory storage, not disk: ImageUploadService decides where the
   * bytes ultimately land (S3 in s3 mode, ingestion's shared storage
   * directory in local mode), and a temp file on this Lambda/container's own
   * disk would be one more thing to clean up for no benefit - a handful of
   * photos per listing comfortably fits in memory.
   */
  @Post(':id/images')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER', 'ADMIN')
  @UseInterceptors(FilesInterceptor('images', 10))
  uploadImages(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one image file is required');
    }
    return this.listingService.uploadImages(id, actor, files);
  }

  /**
   * FR-58: removes one photo without touching the rest - see
   * ListingService.deleteImage for why this needs its own route rather than
   * reusing uploadImages' replace-whole-set semantics.
   */
  @Delete(':id/images/:imageId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER', 'ADMIN')
  deleteImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.listingService.deleteImage(id, imageId, actor);
  }
}
