import { NotFoundException } from '@nestjs/common';
import { RecommendationsService } from '../../../../src/modules/recommendations/services/recommendations.service';

describe('RecommendationsService', () => {
  const repository = {
    vehicleExists: jest.fn(),
    findSimilarVehicles: jest.fn(),
  };
  const service = new RecommendationsService(repository as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns the vehicle id alongside its recommendations', async () => {
    repository.vehicleExists.mockResolvedValue(true);
    repository.findSimilarVehicles.mockResolvedValue([{ id: 'v-2' }]);

    await expect(service.getRecommendations('v-1', 6)).resolves.toEqual({
      vehicleId: 'v-1',
      recommendations: [{ id: 'v-2' }],
    });
  });

  it('404s for a vehicle that does not exist', async () => {
    // Distinguishes "no such vehicle" from "no similar vehicles" — the second
    // is a legitimate empty list, and conflating them would show an error page
    // for a rare car.
    repository.vehicleExists.mockResolvedValue(false);

    await expect(service.getRecommendations('v-1', 6)).rejects.toThrow(NotFoundException);
  });

  it('names the vehicle in the 404', async () => {
    repository.vehicleExists.mockResolvedValue(false);

    await expect(service.getRecommendations('v-1', 6)).rejects.toThrow(
      'Vehicle v-1 was not found',
    );
  });

  it('does not query for similar vehicles when the target is missing', async () => {
    repository.vehicleExists.mockResolvedValue(false);

    await expect(service.getRecommendations('v-1', 6)).rejects.toThrow();

    expect(repository.findSimilarVehicles).not.toHaveBeenCalled();
  });

  it('defaults the limit to 6', async () => {
    repository.vehicleExists.mockResolvedValue(true);
    repository.findSimilarVehicles.mockResolvedValue([]);

    await service.getRecommendations('v-1');

    expect(repository.findSimilarVehicles).toHaveBeenCalledWith('v-1', 6);
  });

  it('returns an empty list when nothing is similar', async () => {
    repository.vehicleExists.mockResolvedValue(true);
    repository.findSimilarVehicles.mockResolvedValue([]);

    await expect(service.getRecommendations('v-1', 6)).resolves.toEqual({
      vehicleId: 'v-1',
      recommendations: [],
    });
  });
});
