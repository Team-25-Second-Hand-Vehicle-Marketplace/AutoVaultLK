import { Module } from '@nestjs/common';
import { ListingController } from './controllers/listing.controller';
import { ListingService } from './services/listing.service';

@Module({
  controllers: [ListingController],
  providers: [ListingService],
  exports: [ListingService],
})
export class ListingModule {}