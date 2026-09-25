import { build } from 'esbuild';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// archiver is CommonJS-only and doesn't expose a default export under
// strict ESM interop — require() it instead of import.
const require = createRequire(import.meta.url);
const archiver = require('archiver');

/**
 * Bundles each zip-packaged stage Lambda (per function-config.json, emitted
 * by `npm run build:lambda-config`) into a self-contained
 * dist-lambda/<slug>.zip — the artifact Terraform's stage_lambda_zip module
 * expects at s3://<bucket>/lambda-artifacts/<slug>.zip (see
 * environments/production/README.md's bootstrap steps).
 *
 * esbuild bundles the handler and every dependency (this service uses AWS SDK
 * v3 modular clients, which the nodejs22.x Lambda runtime does not provide) —
 * only Node builtins are left external. One file per function keeps each zip
 * small and cold starts fast, matching STEP-FUNCTIONS-MIGRATION-PLAN.md §S7's
 * reasoning for zip over container packaging here.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distLambdaDir = join(rootDir, 'dist-lambda');
const configPath = join(distLambdaDir, 'function-config.json');

if (!existsSync(configPath)) {
  console.error(
    `${configPath} not found — run "npm run build:lambda-config" first.`,
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(configPath, 'utf8'));
const zipFunctions = manifest.filter((fn) => fn.packaging === 'zip');

async function zipDirectory(sourceDir, outFile) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    // Contents at the zip root (not nested under the slug dir), so the
    // configured handler stays a plain "index.handler" for every function.
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function main() {
  for (const fn of zipFunctions) {
    const bundleDir = join(distLambdaDir, fn.slug);
    await mkdir(bundleDir, { recursive: true });

    await build({
      entryPoints: [join(rootDir, 'src', 'lambda', `${fn.slug}.ts`)],
      outfile: join(bundleDir, 'index.js'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      sourcemap: false,
      minify: false,
      // bootstrap.ts pulls in @nestjs/core transitively (for its DI-less
      // config/entity wiring); @nestjs/core conditionally requires these two
      // optional peers for microservices/websockets support that this
      // service never uses. They're never actually invoked at runtime, but
      // esbuild still needs to resolve the require() calls at bundle time.
      external: ['@nestjs/microservices', '@nestjs/websockets'],
    });

    const zipPath = join(distLambdaDir, `${fn.slug}.zip`);
    await zipDirectory(bundleDir, zipPath);
    console.log(`Built ${zipPath}`);
  }

  console.log(`Built ${zipFunctions.length} zip-packaged Lambda bundles.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
