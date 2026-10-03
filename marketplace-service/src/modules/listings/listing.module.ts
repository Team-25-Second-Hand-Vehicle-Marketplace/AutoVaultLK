import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Vehicle } from '../../infrastructure/database/entities/vehicle.entity';
import { ListingController } from './controllers/listing.controller';
import { InternalListingLifecycleController } from './controllers/internal-listing-lifecycle.controller';
import { ListingLifecycleService } from './services/listing-lifecycle.service';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard';
import { ListingService } from './services/listing.service';
import { ListingSearchIndexService } from './services/listing-search-index.service';
import { ListingRepository } from './repositories/listing.repository';

import { DealerModule } from '../dealers/dealer.module';
import { ImagesModule } from '../images/images.module';
import { JwtAuthModule } from '../auth/jwt-auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Vehicle]),
    DealerModule,
    ImagesModule,
    JwtAuthModule,
  ],
  controllers: [ListingController, InternalListingLifecycleController],
  providers: [
    ListingService,
    ListingRepository,
    ListingSearchIndexService,
    ListingLifecycleService,
    InternalServiceGuard,
  ],
  exports: [ListingService],
})
export class ListingModule {}
