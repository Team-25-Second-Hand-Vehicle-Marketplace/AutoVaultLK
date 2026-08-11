const { readText, SAD_PUBLIC_PREFIXES, INTERNAL_PREFIX } = require('./fixtures');
const { PROXY_ROUTE_ALIGNMENT } = require('./proxy-route-alignment');

function extractProxyPass(nginxConf, locationPrefix) {
  const pattern = new RegExp(
    `location\\s+${locationPrefix.replace(/\//g, '\\/')}[\\s\\S]*?proxy_pass\\s+http:\\/\\/([^;]+);`,
  );
  const match = nginxConf.match(pattern);
  return match ? match[1] : null;
}

describe('local nginx.conf', () => {
  const nginxConf = readText('local/nginx.conf');
  const validateNginxScript = readText('scripts/validate-nginx.js');

  function locationPrefixes() {
    const matches = nginxConf.matchAll(/location\s+(\/[^;\s]+)/g);
    return [...matches].map((m) => m[1]);
  }

  it('listens on port 8080', () => {
    expect(nginxConf).toMatch(/listen\s+8080/);
  });

  it('proxies each SAD public prefix', () => {
    const locations = locationPrefixes();

    for (const prefix of SAD_PUBLIC_PREFIXES) {
      expect(locations).toContain(`/${prefix}/`);
    }
  });

  it('proxies auth-user-service user and dealer profile routes', () => {
    const locations = locationPrefixes();
    expect(locations).toContain('/users/');
    expect(locations).toContain('/dealer-profiles/');
  });

  it('does not expose internal routes on the public listener', () => {
    expect(nginxConf).not.toMatch(new RegExp(`location\\s+/${INTERNAL_PREFIX}/`));
  });

  it('forwards auth with /auth/ path preserved', () => {
    expect(nginxConf).toMatch(
      /location\s+\/auth\/[\s\S]*?proxy_pass\s+http:\/\/auth_user_service\/auth\//,
    );
  });

  it('forwards users with /users/ path preserved', () => {
    expect(nginxConf).toMatch(
      /location\s+\/users\/[\s\S]*?proxy_pass\s+http:\/\/auth_user_service\/users\//,
    );
  });

  it('forwards dealer profiles with /dealer-profiles/ path preserved', () => {
    expect(nginxConf).toMatch(
      /location\s+\/dealer-profiles\/[\s\S]*?proxy_pass\s+http:\/\/auth_user_service\/dealer-profiles\//,
    );
  });

  it('strips marketplace prefix when forwarding', () => {
    expect(nginxConf).toMatch(
      /location\s+\/marketplace\/[\s\S]*?proxy_pass\s+http:\/\/marketplace_service\//,
    );
  });

  it('aligns each location proxy_pass with implemented service controller paths', () => {
    for (const route of PROXY_ROUTE_ALIGNMENT) {
      const proxyTarget = extractProxyPass(nginxConf, route.location);
      expect(proxyTarget).toBe(`${route.upstream}${route.proxyPath}`);
    }
  });

  it('targets standard local service ports', () => {
    expect(nginxConf).toContain('host.docker.internal:3001');
    expect(nginxConf).toContain('host.docker.internal:3002');
    expect(nginxConf).toContain('host.docker.internal:3003');
    expect(nginxConf).toContain('host.docker.internal:3004');
    expect(nginxConf).toContain('host.docker.internal:3005');
  });

  it('adds host.docker.internal mapping when validating nginx in Docker', () => {
    expect(validateNginxScript).toContain('--add-host=host.docker.internal:host-gateway');
  });

  it('exposes gateway health endpoint', () => {
    expect(nginxConf).toMatch(/location\s+=\s+\/health/);
  });

  it('sets gateway identification headers', () => {
    expect(nginxConf).toContain('X-Gateway vehicle-marketplace-api-gateway');
    expect(nginxConf).toContain('X-Gateway-Version v1.0');
  });
});
