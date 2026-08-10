const { readText, SAD_PUBLIC_PREFIXES, INTERNAL_PREFIX } = require('./fixtures');

describe('local nginx.conf', () => {
  const nginxConf = readText('local/nginx.conf');

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

  it('does not expose internal routes on the public listener', () => {
    expect(nginxConf).not.toMatch(new RegExp(`location\\s+/${INTERNAL_PREFIX}/`));
  });

  it('forwards auth with /auth/ path preserved', () => {
    expect(nginxConf).toMatch(
      /location\s+\/auth\/[\s\S]*?proxy_pass\s+http:\/\/auth_user_service\/auth\//,
    );
  });

  it('strips marketplace prefix when forwarding', () => {
    expect(nginxConf).toMatch(
      /location\s+\/marketplace\/[\s\S]*?proxy_pass\s+http:\/\/marketplace_service\//,
    );
  });

  it('targets standard local service ports', () => {
    expect(nginxConf).toContain('host.docker.internal:3001');
    expect(nginxConf).toContain('host.docker.internal:3002');
    expect(nginxConf).toContain('host.docker.internal:3003');
    expect(nginxConf).toContain('host.docker.internal:3004');
    expect(nginxConf).toContain('host.docker.internal:3005');
  });

  it('exposes gateway health endpoint', () => {
    expect(nginxConf).toMatch(/location\s+=\s+\/health/);
  });

  it('sets gateway identification headers', () => {
    expect(nginxConf).toContain('X-Gateway vehicle-marketplace-api-gateway');
    expect(nginxConf).toContain('X-Gateway-Version v1.0');
  });
});
