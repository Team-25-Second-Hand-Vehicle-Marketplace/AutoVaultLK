import { Module } from '@nestjs/common';
import { SearchController } from './controllers/search.controller';
import { FilterSearchService } from './services/filter-search.service';
import { SearchOptionsService } from './services/search-options.service';
import { VehicleSearchRepository } from './repositories/vehicle-search.repository';

@Module({
  controllers: [SearchController],
  providers: [FilterSearchService, SearchOptionsService, VehicleSearchRepository],
})
export class SearchModule {}
