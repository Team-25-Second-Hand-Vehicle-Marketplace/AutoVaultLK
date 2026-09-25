import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FUNCTION_CONFIGS } from '../src/infrastructure/step-functions/function-config';

/**
 * Emits ingestion-service/dist-lambda/function-config.json — the manifest
 * Terraform's stage_lambda_zip module reads (jsondecode) to create the 10
 * zip-packaged stage Lambdas and their env vars, and the state machine module
 * reads to fill in the ASL's `${XxxFunctionArn}` placeholders. See
 * function-config.ts's own comment and STEP-FUNCTIONS-MIGRATION-PLAN.md §S8.
 *
 * FUNCTION_CONFIGS is the single source of truth in code; this script's only
 * job is to add the one thing Terraform needs that TypeScript doesn't carry
 * at runtime — each function's ASL placeholder name.
 */

function arnPlaceholder(slug: string): string {
  return (
    slug
      .split('-')
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join('') + 'FunctionArn'
  );
}

const manifest = Object.values(FUNCTION_CONFIGS).map((config) => ({
  slug: config.slug,
  arnPlaceholder: arnPlaceholder(config.slug),
  packaging: config.packaging,
  memoryMb: config.memoryMb,
  timeoutSeconds: config.timeoutSeconds,
  env: config.env,
}));

const outDir = join(__dirname, '..', 'dist-lambda');
mkdirSync(outDir, { recursive: true });

const outFile = join(outDir, 'function-config.json');
writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Wrote ${manifest.length} function configs to ${outFile}`);
