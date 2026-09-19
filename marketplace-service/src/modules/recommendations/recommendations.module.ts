import { Module } from '@nestjs/common';

import { RecommendationsController } from './controllers/recommendations.controller';
import { RecommendationsRepository } from './repositories/recommendations.repository';
import { RecommendationsService } from './services/recommendations.service';

@Module({
  controllers: [
    RecommendationsController,
  ],

  providers: [
    RecommendationsRepository,
    RecommendationsService,
  ],

  exports: [
    RecommendationsService,
  ],
})
export class RecommendationsModule {}