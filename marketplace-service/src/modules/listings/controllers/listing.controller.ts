import { Controller, Get } from '@nestjs/common';
import { ListingService } from '../services/listing.service';

@Controller('listings')
export class ListingController {
  constructor(private readonly listingService: ListingService) {}

  @Get('status')
  getStatus() {
    return {
      module: 'Listings',
      status: this.listingService.getStatus(),
    };
  }
}