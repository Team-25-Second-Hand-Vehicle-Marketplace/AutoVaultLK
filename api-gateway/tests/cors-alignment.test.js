const fs = require('node:fs');
const path = require('node:path');
const {
  loadCorsConfig,
  normalizeHeaderList,
  CORS_CONFIG_PATH,
} = require('../config/cors');
const { loadYaml, readText } = require('./fixtures');

const REPO_ROOT = path.join(__dirname, '..', '..');
const TERRAFORM_MAIN = path.join(
  REPO_ROOT,
  'cloud-infrastructure',
  'terraform',
  'modules',
  'api-gateway',
  'main.tf',
);

function parseNginxCors(nginxConf) {
  const blockMatch = nginxConf.match(
    /# BEGIN CORS[\s\S]*?# END CORS/,
  );
  expect(blockMatch).not.toBeNull();

  const block = blockMatch[0];
  const origin = block.match(
    /Access-Control-Allow-Origin\s+(\S+)\s+always/,
  )?.[1];
  const credentials = block.match(
    /Access-Control-Allow-Credentials\s+(\S+)\s+always/,
  )?.[1];
  const headers = block
    .match(/Access-Control-Allow-Headers\s+"([^"]+)"/)?.[1]
    ?.split(',')
    .map((header) => header.trim());
  const methods = block
    .match(/Access-Control-Allow-Methods\s+"([^"]+)"/)?.[1]
    ?.split(',')
    .map((method) => method.trim());

  return { origin, credentials, headers, methods };
}

describe('CORS single source of truth (config/cors.json)', () => {
  const config = loadCorsConfig();

  it('defines the canonical CORS config file', () => {
    expect(fs.existsSync(CORS_CONFIG_PATH)).toBe(true);
    expect(config.allowOrigins.length).toBeGreaterThan(0);
    expect(config.allowMethods.length).toBeGreaterThan(0);
    expect(config.allowHeaders.length).toBeGreaterThan(0);
  });

  it('matches local nginx.conf CORS headers', () => {
    const nginxConf = readText('local/nginx.conf');
    const nginxCors = parseNginxCors(nginxConf);

    expect(nginxCors.origin).toBe(config.allowOrigins[0]);
    expect(nginxCors.credentials).toBe(String(config.allowCredentials));
    expect(nginxCors.methods).toEqual(config.allowMethods);
    expect(normalizeHeaderList(nginxCors.headers)).toEqual(
      normalizeHeaderList(config.allowHeaders),
    );
  });

  it('matches public OpenAPI x-amazon-apigateway-cors extension', () => {
    const spec = loadYaml('openapi/public-api.yaml');
    const cors = spec['x-amazon-apigateway-cors'];

    expect(cors.allowOrigins).toEqual(config.allowOrigins);
    expect(cors.allowMethods).toEqual(config.allowMethods);
    expect(cors.allowHeaders).toEqual(config.allowHeaders);
    expect(cors.allowCredentials).toBe(config.allowCredentials);
  });

  it('wires Terraform public API CORS to config/cors.json', () => {
    const terraformMain = fs.readFileSync(TERRAFORM_MAIN, 'utf8');

    expect(terraformMain).toContain(
      'jsondecode(file("${path.module}/../../../../api-gateway/config/cors.json"))',
    );
    expect(terraformMain).toContain('local.cors_allow_origins');
    expect(terraformMain).toContain('local.cors.allowMethods');
    expect(terraformMain).toContain('local.cors.allowHeaders');
    expect(terraformMain).toContain('local.cors.allowCredentials');
  });
});
