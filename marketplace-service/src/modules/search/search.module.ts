import { Module } from '@nestjs/common';
import { SearchController } from './controllers/search.controller';
import { FilterSearchService } from './services/filter-search.service';
import { NlSearchService } from './services/nl-search.service';
import { SearchOptionsService } from './services/search-options.service';
import { VehicleDictionaryRepository } from './repositories/vehicle-dictionary.repository';
import { VehicleSearchRepository } from './repositories/vehicle-search.repository';
import { GroqClient } from './groq/groq-client';
import { GroqFallbackService } from './groq/groq-fallback.service';
import { QueryEmbeddingService } from './services/query-embedding.service';

@Module({
  controllers: [SearchController],
  providers: [
    FilterSearchService,
    NlSearchService,
    QueryEmbeddingService,
    SearchOptionsService,
    VehicleDictionaryRepository,
    VehicleSearchRepository,
    GroqClient,
    GroqFallbackService,
  ],
})
export class SearchModule {}
