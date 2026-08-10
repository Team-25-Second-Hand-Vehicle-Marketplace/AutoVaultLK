const path = require('node:path');
const fs = require('node:fs');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');

function loadYaml(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.load(raw);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** First path segment: /auth/login -> auth */
function pathPrefix(openApiPath) {
  const segment = openApiPath.split('/').filter(Boolean)[0];
  return segment ?? '';
}

/** SAD section 3.5.1 public route prefixes */
const SAD_PUBLIC_PREFIXES = [
  'auth',
  'marketplace',
  'ingest',
  'jobs',
  'admin',
];

/** Internal routes must not appear on the public nginx listener */
const INTERNAL_PREFIX = 'internal';

module.exports = {
  ROOT,
  loadYaml,
  readText,
  pathPrefix,
  SAD_PUBLIC_PREFIXES,
  INTERNAL_PREFIX,
};
