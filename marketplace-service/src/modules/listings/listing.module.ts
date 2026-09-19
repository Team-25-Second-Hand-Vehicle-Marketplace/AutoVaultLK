import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Vehicle } from '../../infrastructure/database/entities/vehicle.entity';
import { ListingController } from './controllers/listing.controller';
import { ListingService } from './services/listing.service';
import { ListingSearchIndexService } from './services/listing-search-index.service';
import { ListingRepository } from './repositories/listing.repository';

import { DealerModule } from '../dealers/dealer.module';
import { JwtAuthModule } from '../auth/jwt-auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Vehicle]), DealerModule, JwtAuthModule],
  controllers: [ListingController],
  providers: [ListingService, ListingRepository, ListingSearchIndexService],
  exports: [ListingService],
})
export class ListingModule {}
