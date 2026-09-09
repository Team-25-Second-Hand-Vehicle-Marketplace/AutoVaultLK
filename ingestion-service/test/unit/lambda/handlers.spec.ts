import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHUNK_STAGES,
  FILE_STAGES,
  stageSlug,
} from '../../../src/workers/etl-worker/pipeline/graph';

const LAMBDA_DIR = resolve(__dirname, '../../../src/lambda');

/**
 * Every stage the pipeline declares must have a handler, or the state machine
 * references a Lambda that does not exist — and the failure appears at deploy
 * time, or worse at run time, rather than here.
 *
 * The reverse direction matters too: a handler with no stage is dead code that
 * still gets packaged, deployed and paid for.
 */
describe('lambda handlers', () => {
  const owned = [...FILE_STAGES, ...CHUNK_STAGES];

  it.each(owned)('has a handler file for %s', (stage) => {
    expect(existsSync(resolve(LAMBDA_DIR, `${stageSlug(stage)}.ts`))).toBe(true);
  });

  it('exports a handler from every stage file', () => {
    // require rather than import(): Jest needs --experimental-vm-modules for
    // dynamic ESM imports, and a dynamic path is the whole point here.
    for (const stage of owned) {
      const loaded = require(
        resolve(LAMBDA_DIR, stageSlug(stage)),
      ) as Record<string, unknown>;

      expect(typeof loaded.handler).toBe('function');
    }
  });

  it('names files to match the ASL states and the stage slugs', () => {
    // The Dockerfile's CMD is dist/lambda/<slug>.handler, so the filename is
    // part of the deployment contract, not a convention.
    expect(stageSlug('PARSE_NORMALIZE')).toBe('parse-normalize');
    expect(existsSync(resolve(LAMBDA_DIR, 'parse-normalize.ts'))).toBe(true);
  });

  it('has an aggregate handler, which closes the Map', () => {
    // Not in CHUNK_STAGES — it runs once after the fan-out, so it is checked
    // separately rather than by the loop above.
    expect(existsSync(resolve(LAMBDA_DIR, 'aggregate-results.ts'))).toBe(true);
  });

  it('keeps handlers thin', () => {
    // A handler should add packaging, not behaviour. Anything that belongs to
    // the pipeline lives in the stage or in asChunkStage, so LocalOrchestrator
    // and Step Functions run identical code — the moment logic leaks in here,
    // the two executors have started to drift.
    for (const stage of CHUNK_STAGES) {
      if (stage === 'LOAD') continue; // terminates the chain, needs its own body

      const source = readFileSync(resolve(LAMBDA_DIR, `${stageSlug(stage)}.ts`), 'utf8');
      const code = source
        .split('\n')
        .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('/'))
        .filter((line) => line.trim().length > 0);

      expect(code.length).toBeLessThanOrEqual(12);
      expect(source).toContain('runChunkStage');
    }
  });
});
