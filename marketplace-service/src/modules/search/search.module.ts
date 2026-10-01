import { Module } from '@nestjs/common';
import { ImagesModule } from '../images/images.module';
import { InternalDictionaryController } from './controllers/internal-dictionary.controller';
import { SearchController } from './controllers/search.controller';
import { FilterSearchService } from './services/filter-search.service';
import { NlSearchService } from './services/nl-search.service';
import { SearchOptionsService } from './services/search-options.service';
import { VehicleDictionaryRepository } from './repositories/vehicle-dictionary.repository';
import { VehicleSearchRepository } from './repositories/vehicle-search.repository';
import { GroqClient } from './groq/groq-client';
import { GroqFallbackService } from './groq/groq-fallback.service';
import { QueryEmbeddingService } from './services/query-embedding.service';
import { AliasPromotionRepository } from './repositories/alias-promotion.repository';
import { AliasPromotionService } from './services/alias-promotion.service';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard';

@Module({
  imports: [ImagesModule],
  controllers: [SearchController, InternalDictionaryController],
  providers: [
    FilterSearchService,
    NlSearchService,
    QueryEmbeddingService,
    SearchOptionsService,
    VehicleDictionaryRepository,
    VehicleSearchRepository,
    AliasPromotionRepository,
    AliasPromotionService,
    GroqClient,
    GroqFallbackService,
    InternalServiceGuard,
  ],
})
export class SearchModule {}
