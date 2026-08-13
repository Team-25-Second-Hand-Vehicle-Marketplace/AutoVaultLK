import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import { ListingService } from '../services/listing.service';
import { CreateListingDto } from '../dto/create-listing.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';

@Controller('listings')
export class ListingController {
  constructor(
    private readonly listingService: ListingService,
  ) {}

  @Post()
  createListing(@Body() dto: CreateListingDto) {
    return this.listingService.createListing(dto);
  }

  @Get()
  getAllListings() {
    return this.listingService.getAllListings();
  }

  @Get(':id')
  getListingById(@Param('id', ParseUUIDPipe) id: string) {
    return this.listingService.getListingById(id);
  }

  @Patch(':id')
  updateListing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.listingService.updateListing(id, dto);
  }

  @Patch(':id/deactivate')
  deactivateListing(@Param('id', ParseUUIDPipe) id: string) {
    return this.listingService.deactivateListing(id);
  }
}
