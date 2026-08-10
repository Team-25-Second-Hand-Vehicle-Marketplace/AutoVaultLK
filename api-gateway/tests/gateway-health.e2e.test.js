/**
 * Optional live gateway test. Skipped unless RUN_GATEWAY_E2E=true and nginx is up:
 *   docker compose -f docker-compose.dev.yml up gateway -d
 *   cd api-gateway && RUN_GATEWAY_E2E=true npm test -- gateway-health
 */

const GATEWAY_URL = process.env.API_GATEWAY_URL ?? 'http://localhost:8080';
const runLive = process.env.RUN_GATEWAY_E2E === 'true';

(runLive ? describe : describe.skip)('live gateway (e2e)', () => {
  it('GET /health returns ok', async () => {
    const response = await fetch(`${GATEWAY_URL}/health`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.gateway).toBe('local-nginx');
  }, 10_000);
});
