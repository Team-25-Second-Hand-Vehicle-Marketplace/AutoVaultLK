import { Body, Controller, Post } from '@nestjs/common';

import { CreateListingDto } from '../dto/create-listing.dto';
import { ListingService } from '../services/listing.service';

/** Internal-only routes (ingestion ETL). Matches internal-api.yaml /internal/listings/bulk. */
@Controller('internal/listings')
export class InternalListingsController {
  constructor(private readonly listingService: ListingService) {}

  @Post('bulk')
  createBulkListings(@Body() dtos: CreateListingDto[]) {
    return this.listingService.createBulkListings(dtos);
  }
}
