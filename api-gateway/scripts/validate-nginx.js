const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const confPath = path.resolve(__dirname, '../local/nginx.conf');

if (!fs.existsSync(confPath)) {
  console.error(`nginx.conf not found: ${confPath}`);
  process.exit(1);
}

/** Docker Desktop on Windows accepts C:/style paths in -v mounts */
const mountSource =
  process.platform === 'win32'
    ? confPath.replace(/\\/g, '/')
    : confPath;

const command = [
  'docker run --rm',
  `-v "${mountSource}:/etc/nginx/nginx.conf:ro"`,
  'nginx:1.27-alpine',
  'nginx -t',
].join(' ');

console.log(`Running: ${command}`);

try {
  execSync(command, { stdio: 'inherit' });
} catch {
  process.exit(1);
}
