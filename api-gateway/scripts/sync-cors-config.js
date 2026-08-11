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

function syncPublicOpenApi(config) {
  const raw = fs.readFileSync(PUBLIC_OPENAPI, 'utf8');
  const doc = yaml.load(raw);
  const extension = renderOpenApiCorsExtension(config);

  delete doc['x-amazon-apigateway-cors'];
  Object.assign(doc, extension);

  const body = yaml.dump(doc, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });

  fs.writeFileSync(PUBLIC_OPENAPI, body);
}

function main() {
  const config = loadCorsConfig();
  syncNginx(config);
  syncPublicOpenApi(config);
  console.log('Synced CORS from config/cors.json to nginx.conf and public-api.yaml');
}

main();
