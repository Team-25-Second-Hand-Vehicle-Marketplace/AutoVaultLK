import { HealthController } from '../../src/health/health.controller';

describe('HealthController', () => {
  it('returns the auth-user service health status', () => {
    expect(new HealthController().check()).toEqual({
      status: 'ok',
      service: 'auth-user-service',
    });
  });
});
