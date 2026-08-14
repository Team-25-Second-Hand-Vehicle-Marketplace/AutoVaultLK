import { Module } from '@nestjs/common';
import { SearchController } from './controllers/search.controller';
import { FilterSearchService } from './services/filter-search.service';
import { NlSearchService } from './services/nl-search.service';
import { SearchOptionsService } from './services/search-options.service';
import { VehicleDictionaryRepository } from './repositories/vehicle-dictionary.repository';
import { VehicleSearchRepository } from './repositories/vehicle-search.repository';

@Module({
  controllers: [SearchController],
  providers: [
    FilterSearchService,
    NlSearchService,
    SearchOptionsService,
    VehicleDictionaryRepository,
    VehicleSearchRepository,
  ],
})
export class SearchModule {}
