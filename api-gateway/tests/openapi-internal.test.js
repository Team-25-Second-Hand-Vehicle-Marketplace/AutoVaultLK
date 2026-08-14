const SwaggerParser = require('@apidevtools/swagger-parser');
const path = require('node:path');
const { loadYaml, pathPrefix } = require('./fixtures');

const INTERNAL_SPEC = path.join(__dirname, '..', 'openapi', 'internal-api.yaml');

describe('internal OpenAPI spec (ADR-005)', () => {
  let spec;

  beforeAll(async () => {
    spec = await SwaggerParser.validate(INTERNAL_SPEC);
  });

  it('is valid OpenAPI 3.x', () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toContain('Internal');
  });

  it('documents ADR-002 direct-write for ETL listing persistence', () => {
    expect(spec.info.description).toMatch(/MarketplaceVehiclesWriteAdapter/i);
    expect(spec.info.description).toMatch(/not on this API/i);
    expect(spec.paths['/internal/listings/bulk']).toBeUndefined();
  });

  it('documents east-west auth and notification routes', () => {
    for (const route of Object.keys(spec.paths)) {
      const prefix = pathPrefix(route);
      expect(['internal', 'notifications']).toContain(prefix);
    }
  });

  it('defines admin-to-auth dealer approval routes (FR-43)', () => {
    expect(spec.paths['/internal/dealers/{id}/approve']).toBeDefined();
    expect(spec.paths['/internal/dealers/{id}/reject']).toBeDefined();
    expect(spec.paths['/internal/users/{id}/deactivate']).toBeDefined();
    expect(spec.paths['/notifications/events']).toBeDefined();
  });

  it('documents service-to-service security scheme', () => {
    expect(spec.components.securitySchemes.serviceKey).toBeDefined();
    expect(spec.components.securitySchemes.serviceKey.name).toBe(
      'X-Internal-Service-Key',
    );
  });
});

describe('internal OpenAPI YAML structure', () => {
  it('loads without YAML errors', () => {
    const doc = loadYaml('openapi/internal-api.yaml');
    expect(Object.keys(doc.paths).length).toBe(4);
  });

  it('server URL variables match servers.variables keys', () => {
    const doc = loadYaml('openapi/internal-api.yaml');
    const server = doc.servers[0];
    const declared = Object.keys(server.variables);
    const used = [...server.url.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);

    for (const name of used) {
      expect(declared).toContain(name);
    }
  });
});
