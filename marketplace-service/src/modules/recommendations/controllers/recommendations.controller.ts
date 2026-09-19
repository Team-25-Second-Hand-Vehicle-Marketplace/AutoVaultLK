import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';

import { RecommendationsService } from '../services/recommendations.service';

@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly service: RecommendationsService,
  ) {}

  @Get('vehicles/:vehicleId')
  async getRecommendations(
    @Param('vehicleId') vehicleId: string,
    @Query(
      'limit',
      new ParseIntPipe({
        optional: true,
      }),
    )
    limit?: number,
  ) {
    const safeLimit = Math.min(
      Math.max(limit ?? 6, 1),
      20,
    );

    return this.service.getRecommendations(
      vehicleId,
      safeLimit,
    );
  }
}