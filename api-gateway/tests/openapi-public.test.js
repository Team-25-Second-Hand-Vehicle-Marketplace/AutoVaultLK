const SwaggerParser = require('@apidevtools/swagger-parser');
const path = require('node:path');
const {
  loadYaml,
  pathPrefix,
  SAD_PUBLIC_PREFIXES,
} = require('./fixtures');

const PUBLIC_SPEC = path.join(__dirname, '..', 'openapi', 'public-api.yaml');

describe('public OpenAPI spec', () => {
  let spec;

  beforeAll(async () => {
    spec = await SwaggerParser.validate(PUBLIC_SPEC);
  });

  it('is valid OpenAPI 3.x', () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toContain('Public API');
  });

  it('includes a local development server on port 8080', () => {
    const urls = spec.servers.map((s) => s.url);
    expect(urls.some((u) => u.includes('localhost:8080'))).toBe(true);
  });

  it('defines all SAD section 3.5.1 route prefixes', () => {
    const prefixes = new Set(
      Object.keys(spec.paths).map((p) => pathPrefix(p)),
    );

    for (const required of SAD_PUBLIC_PREFIXES) {
      expect(prefixes.has(required)).toBe(true);
    }
  });

  it('exposes public auth routes without bearer security', () => {
    const publicAuthPaths = [
      '/auth/register/buyer',
      '/auth/register/dealer',
      '/auth/login',
      '/auth/login/admin',
      '/auth/refresh',
    ];

    for (const route of publicAuthPaths) {
      const item = spec.paths[route];
      expect(item).toBeDefined();
      const operation = item.post ?? item.get;
      expect(operation).toBeDefined();
      expect(operation.security).toBeUndefined();
    }
  });

  it('allows anonymous marketplace listing browse', () => {
    const listOp = spec.paths['/marketplace/listings'].get;
    expect(listOp).toBeDefined();
    expect(listOp.security).toBeUndefined();
  });

  it('requires JWT for protected marketplace mutations', () => {
    const createOp = spec.paths['/marketplace/listings'].post;
    expect(createOp.security).toEqual([{ bearerAuth: [] }]);
  });

  it('documents upload intake as 202 Accepted', () => {
    const upload = spec.paths['/ingest/upload'].post;
    expect(upload.responses['202']).toBeDefined();
  });
});

describe('public OpenAPI YAML structure', () => {
  it('loads without YAML errors', () => {
    const doc = loadYaml('openapi/public-api.yaml');
    expect(Object.keys(doc.paths).length).toBeGreaterThan(5);
  });
});
