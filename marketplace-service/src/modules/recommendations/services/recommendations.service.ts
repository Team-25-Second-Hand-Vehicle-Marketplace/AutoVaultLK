import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { RecommendationsRepository } from '../repositories/recommendations.repository';

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly repository: RecommendationsRepository,
  ) {}

  async getRecommendations(
    vehicleId: string,
    limit = 6,
  ) {
    const exists =
      await this.repository.vehicleExists(vehicleId);

    if (!exists) {
      throw new NotFoundException(
        `Vehicle ${vehicleId} was not found`,
      );
    }

    const recommendations =
      await this.repository.findSimilarVehicles(
        vehicleId,
        limit,
      );

    return {
      vehicleId,
      recommendations,
    };
  }
}