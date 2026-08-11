const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const {
  loadCorsConfig,
  renderNginxCorsBlock,
  renderOpenApiCorsExtension,
} = require('../config/cors');

const ROOT = path.join(__dirname, '..');
const NGINX_CONF = path.join(ROOT, 'local', 'nginx.conf');
const PUBLIC_OPENAPI = path.join(ROOT, 'openapi', 'public-api.yaml');

function syncNginx(config) {
  const nginxConf = fs.readFileSync(NGINX_CONF, 'utf8');
  const block = renderNginxCorsBlock(config);
  const pattern = / {4}# BEGIN CORS[\s\S]*? {4}# END CORS/;

  if (!pattern.test(nginxConf)) {
    throw new Error(
      'nginx.conf is missing CORS markers (# BEGIN CORS / # END CORS)',
    );
  }

  const updated = nginxConf.replace(pattern, block);
  fs.writeFileSync(NGINX_CONF, updated);
}

function renderOpenApiCorsYaml(config) {
  const extension = renderOpenApiCorsExtension(config);
  return yaml.dump(extension, { lineWidth: -1, noRefs: true }).trim();
}

function syncPublicOpenApi(config) {
  const raw = fs.readFileSync(PUBLIC_OPENAPI, 'utf8');
  const corsYaml = renderOpenApiCorsYaml(config);
  const pattern = /^x-amazon-apigateway-cors:[\s\S]*$/m;

  if (!pattern.test(raw)) {
    throw new Error(
      'public-api.yaml is missing x-amazon-apigateway-cors extension block',
    );
  }

  const updated = raw.replace(pattern, corsYaml);
  fs.writeFileSync(PUBLIC_OPENAPI, updated.endsWith('\n') ? updated : `${updated}\n`);
}

function main() {
  const config = loadCorsConfig();
  syncNginx(config);
  syncPublicOpenApi(config);
  console.log('Synced CORS from config/cors.json to nginx.conf and public-api.yaml');
}

main();
