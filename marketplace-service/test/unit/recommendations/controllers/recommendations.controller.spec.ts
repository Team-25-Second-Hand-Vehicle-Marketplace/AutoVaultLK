import { RecommendationsController } from '../../../../src/modules/recommendations/controllers/recommendations.controller';

describe('RecommendationsController', () => {
  const service = { getRecommendations: jest.fn() };
  const controller = new RecommendationsController(service as never);

  /** The limit the service was actually called with. */
  const limitPassed = (): number =>
    service.getRecommendations.mock.calls[0][1] as number;

  beforeEach(() => {
    jest.clearAllMocks();
    service.getRecommendations.mockResolvedValue({ vehicleId: 'v-1', recommendations: [] });
  });

  it('passes the vehicle id through untouched', async () => {
    await controller.getRecommendations('v-1', 6);

    expect(service.getRecommendations.mock.calls[0][0]).toBe('v-1');
  });

  describe('the limit clamp', () => {
    // The query param reaches this handler as whatever ParseIntPipe produced,
    // including values a caller chose. Clamping here is what stops
    // `?limit=10000` from turning one page view into a full table scan.
    it.each([
      ['defaults to 6 when absent', undefined, 6],
      ['floors 0 at 1', 0, 1],
      ['floors a negative at 1', -5, 1],
      ['passes 1 through', 1, 1],
      ['passes a mid-range value through', 10, 10],
      ['passes the ceiling through', 20, 20],
      ['caps above the ceiling at 20', 100, 20],
    ])('%s', async (_name, input, expected) => {
      await controller.getRecommendations('v-1', input as number | undefined);

      expect(limitPassed()).toBe(expected);
    });
  });

  it('returns what the service returns', async () => {
    service.getRecommendations.mockResolvedValue({
      vehicleId: 'v-1',
      recommendations: [{ id: 'v-2' }],
    });

    await expect(controller.getRecommendations('v-1', 6)).resolves.toEqual({
      vehicleId: 'v-1',
      recommendations: [{ id: 'v-2' }],
    });
  });
});
