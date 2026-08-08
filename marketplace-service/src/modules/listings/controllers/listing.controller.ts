import { Body, Controller, Post } from '@nestjs/common';
import { ListingService } from '../services/listing.service';
import { CreateListingDto } from '../dto/create-listing.dto';

@Controller('listings')
export class ListingController {
  constructor(
    private readonly listingService: ListingService,
  ) {}

  @Post()
  createListing(
    @Body() dto: CreateListingDto,
  ) {
    return this.listingService.createListing(dto);
  }
}