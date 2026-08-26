import { HealthController } from '../../../src/health/health.controller';

describe('HealthController', () => {
  it('returns the marketplace-service health status', () => {
    expect(new HealthController().check()).toEqual({
      status: 'ok',
      service: 'marketplace-service',
    });
  });
});
