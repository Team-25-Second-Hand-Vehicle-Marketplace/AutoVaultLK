import { Module } from '@nestjs/common';

import { ListingController } from './controllers/listing.controller';
import { ListingService } from './services/listing.service';
import { ListingRepository } from './repositories/listing.repository';

@Module({
  controllers: [ListingController],
  providers: [
    ListingService,
    ListingRepository,
  ],
  exports: [ListingService],
})
export class ListingModule {}