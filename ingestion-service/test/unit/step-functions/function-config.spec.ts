import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FUNCTION_CONFIGS,
  configFor,
} from '../../../src/infrastructure/step-functions/function-config';
import {
  CHUNK_STAGES,
  FILE_STAGES,
  stageSlug,
} from '../../../src/workers/etl-worker/pipeline/graph';

/**
 * The deployment settings are declared in TypeScript so they can be checked
 * against the pipeline's own constraints. A timeout shorter than the database
 * statement_timeout, or a memory size too small for the model, is the kind of
 * mismatch that surfaces only under load in a deployed environment.
 */
describe('lambda function config', () => {
  const configs = Object.values(FUNCTION_CONFIGS);

  it('covers every stage the pipeline declares', () => {
    for (const stage of [...FILE_STAGES, ...CHUNK_STAGES]) {
      expect(configFor(stage)).toBeDefined();
    }
  });

  it('has a handler file for every configured function', () => {
    // A config with no handler deploys a function that cannot start; a handler
    // with no config deploys at Lambda's defaults, which are wrong for embed.
    for (const config of configs) {
      const path = resolve(__dirname, `../../../src/lambda/${config.slug}.ts`);
      expect(existsSync(path)).toBe(true);
    }
  });

  it('names slugs consistently with the graph', () => {
    for (const stage of CHUNK_STAGES) {
      expect(FUNCTION_CONFIGS[stageSlug(stage)]?.slug).toBe(stageSlug(stage));
    }
  });

  describe('timeouts', () => {
    // lambda/bootstrap.ts sets statement_timeout to 55s so a hung query dies
    // before the function does, leaving a clean connection rather than an
    // orphaned one holding an RDS Proxy slot. A function timing out first
    // inverts that.
    const STATEMENT_TIMEOUT_SECONDS = 55;

    it('gives every database-touching function room to outlive a query', () => {
      const touchesDatabase = configs.filter((c) => c.slug !== 'mark-job-failed');

      for (const config of touchesDatabase) {
        expect(config.timeoutSeconds).toBeGreaterThan(STATEMENT_TIMEOUT_SECONDS);
      }
    });

    it('gives groq-normalize room for two attempts', () => {
      // GROQ_TIMEOUT_MS defaults to 8s and the client retries once.
      expect(FUNCTION_CONFIGS['groq-normalize'].timeoutSeconds).toBeGreaterThanOrEqual(60);
    });

    it('gives embed room for a cold model load plus a full chunk', () => {
      expect(FUNCTION_CONFIGS.embed.timeoutSeconds).toBeGreaterThanOrEqual(300);
    });

    it('stays inside the Lambda maximum', () => {
      for (const config of configs) {
        expect(config.timeoutSeconds).toBeLessThanOrEqual(900);
      }
    });
  });

  describe('packaging', () => {
    it('ships embed as a container image', () => {
      // The MiniLM ONNX model is ~90MB against a 250MB unzipped layer cap, and
      // @xenova/transformers brings its own runtime on top.
      expect(FUNCTION_CONFIGS.embed.packaging).toBe('image');
    });

    it('ships everything else as a zip', () => {
      // Zips cold-start faster, and nothing else carries a heavy dependency.
      for (const config of configs.filter((c) => c.slug !== 'embed')) {
        expect(config.packaging).toBe('zip');
      }
    });

    it('has a Dockerfile for every image-packaged function', () => {
      for (const config of configs.filter((c) => c.packaging === 'image')) {
        const path = resolve(__dirname, `../../../docker/${config.slug}.Dockerfile`);
        expect(existsSync(path)).toBe(true);
      }
    });
  });

  describe('memory', () => {
    it('gives embed the most, because Lambda scales CPU with memory', () => {
      // The one function where memory buys speed rather than headroom:
      // inference is CPU-bound.
      const others = configs.filter((c) => c.slug !== 'embed');

      for (const config of others) {
        expect(FUNCTION_CONFIGS.embed.memoryMb).toBeGreaterThan(config.memoryMb);
      }
    });

    it('gives split-chunks more than the row stages', () => {
      // A 25MB upload streams through it, and Lambda scales I/O throughput
      // with memory.
      expect(FUNCTION_CONFIGS['split-chunks'].memoryMb).toBeGreaterThan(
        FUNCTION_CONFIGS['validate-rows'].memoryMb,
      );
    });

    it('stays within Lambda limits', () => {
      for (const config of configs) {
        expect(config.memoryMb).toBeGreaterThanOrEqual(128);
        expect(config.memoryMb).toBeLessThanOrEqual(10240);
      }
    });
  });

  describe('environment', () => {
    it('gives every function what it needs to reach the database and bucket', () => {
      for (const config of configs) {
        expect(config.env).toEqual(
          expect.arrayContaining(['INGESTION_DATABASE_URL', 'INGESTION_S3_BUCKET']),
        );
      }
    });

    it('gives the Groq key to groq-normalize alone', () => {
      // Least privilege for a secret: no other function has a use for it, and
      // a key present in ten function configs is a key in ten places to leak.
      const withKey = configs.filter((c) => c.env.includes('GROQ_API_KEY'));

      expect(withKey.map((c) => c.slug)).toEqual(['groq-normalize']);
    });

    it('gives the embedding switch to embed alone', () => {
      const withSwitch = configs.filter((c) => c.env.includes('EMBEDDING_DISABLED'));

      expect(withSwitch.map((c) => c.slug)).toEqual(['embed']);
    });

    it('does not hand SQS credentials to a stage function', () => {
      // Stages are invoked by Step Functions; none of them publishes. A
      // function with a queue URL it never uses is surface for nothing.
      for (const config of configs) {
        expect(config.env).not.toContain('INGESTION_SQS_QUEUE_URL');
      }
    });
  });
});
