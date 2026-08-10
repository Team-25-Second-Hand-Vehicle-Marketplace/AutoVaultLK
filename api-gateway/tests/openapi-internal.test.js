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

  it('only uses /internal paths', () => {
    for (const route of Object.keys(spec.paths)) {
      expect(route.startsWith('/internal/')).toBe(true);
      expect(pathPrefix(route)).toBe('internal');
    }
  });

  it('defines admin-to-auth dealer approval routes (FR-43)', () => {
    expect(spec.paths['/internal/dealers/{id}/approve']).toBeDefined();
    expect(spec.paths['/internal/dealers/{id}/reject']).toBeDefined();
    expect(spec.paths['/internal/users/{id}/deactivate']).toBeDefined();
  });

  it('defines bulk listing ingest route for marketplace consumer (FR-14)', () => {
    expect(spec.paths['/internal/listings/bulk']).toBeDefined();
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
});
