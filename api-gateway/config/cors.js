const path = require('node:path');
const fs = require('node:fs');

const CORS_CONFIG_PATH = path.join(__dirname, 'cors.json');

function loadCorsConfig() {
  const raw = fs.readFileSync(CORS_CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

function normalizeHeaderList(headers) {
  return headers.map((header) => header.toLowerCase()).sort();
}

function renderNginxCorsBlock(config) {
  const origin = config.allowOrigins[0];
  const headers = config.allowHeaders.join(',');
  const methods = config.allowMethods.join(',');

  return [
    '    # BEGIN CORS (generated from config/cors.json — run: npm run sync:cors)',
    `    add_header Access-Control-Allow-Origin ${origin} always;`,
    `    add_header Access-Control-Allow-Credentials ${config.allowCredentials} always;`,
    `    add_header Access-Control-Allow-Headers "${headers}" always;`,
    `    add_header Access-Control-Allow-Methods "${methods}" always;`,
    '    # END CORS',
  ].join('\n');
}

function renderOpenApiCorsExtension(config) {
  return {
    'x-amazon-apigateway-cors': {
      allowOrigins: [...config.allowOrigins],
      allowMethods: [...config.allowMethods],
      allowHeaders: [...config.allowHeaders],
      allowCredentials: config.allowCredentials,
    },
  };
}

module.exports = {
  CORS_CONFIG_PATH,
  loadCorsConfig,
  normalizeHeaderList,
  renderNginxCorsBlock,
  renderOpenApiCorsExtension,
};
