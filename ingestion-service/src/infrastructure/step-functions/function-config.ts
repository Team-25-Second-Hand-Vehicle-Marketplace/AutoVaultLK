import type { EtlStage } from '../database/entities/etl-stage-log.entity';
import { stageSlug } from '../../workers/etl-worker/pipeline/graph';

/**
 * Per-function deployment settings.
 *
 * Declared in TypeScript rather than straight into Terraform so a test can
 * assert them against the pipeline's own constraints — a timeout shorter than
 * the statement_timeout in lambda/bootstrap.ts, or a memory size too small for
 * the model, is the kind of mismatch that only shows up under load.
 *
 * Terraform reads the emitted JSON; see docs/STEP-FUNCTIONS-MIGRATION-PLAN.md §S8.
 */

export type Packaging = 'zip' | 'image';

export type FunctionConfig = {
  /** Matches the file at src/lambda/<slug>.ts and the ASL state's ARN placeholder. */
  slug: string;
  packaging: Packaging;
  memoryMb: number;
  timeoutSeconds: number;
  /** Env keys this function needs. Terraform sets nothing beyond these. */
  env: string[];
};

/** Every stage Lambda needs these; anything more is per-function. */
const BASE_ENV = [
  'INGESTION_DATABASE_URL',
  'INGESTION_STORAGE_DRIVER',
  'INGESTION_S3_BUCKET',
  'AWS_REGION',
  'DATABASE_SSL',
];

const PIPELINE_ENV = ['INGESTION_CHUNK_SIZE', 'INGESTION_MAX_CONCURRENCY'];

/**
 * Timeouts sit above statement_timeout (55s in lambda/bootstrap.ts) so a hung
 * query dies before the function does, leaving a clean connection rather than
 * an orphaned one holding an RDS Proxy slot.
 */
export const FUNCTION_CONFIGS: Record<string, FunctionConfig> = {
  'validate-file': {
    slug: 'validate-file',
    packaging: 'zip',
    memoryMb: 512,
    // Reads only the first 64KB of the object, whatever its size.
    timeoutSeconds: 60,
    env: BASE_ENV,
  },

  'split-chunks': {
    slug: 'split-chunks',
    packaging: 'zip',
    // Streams rather than buffering, so memory is one chunk regardless of file
    // size — but a 25MB upload still moves through this function, and Lambda
    // scales I/O throughput with memory.
    memoryMb: 1024,
    timeoutSeconds: 300,
    env: [...BASE_ENV, ...PIPELINE_ENV],
  },

  'parse-normalize': {
    slug: 'parse-normalize',
    packaging: 'zip',
    // Holds the dictionary snapshot (177 rows) plus one chunk of raw rows.
    memoryMb: 512,
    timeoutSeconds: 120,
    env: [...BASE_ENV, ...PIPELINE_ENV, 'INGESTION_GROQ_CONFIDENCE_THRESHOLD'],
  },

  'groq-normalize': {
    slug: 'groq-normalize',
    packaging: 'zip',
    memoryMb: 512,
    // Longer than its siblings: it makes an outbound call to a third party and
    // retries once. GROQ_TIMEOUT_MS (8s) times two attempts plus overhead must
    // fit well inside this.
    timeoutSeconds: 120,
    env: [
      ...BASE_ENV,
      ...PIPELINE_ENV,
      'GROQ_API_KEY',
      'GROQ_MODEL',
      'GROQ_TIMEOUT_MS',
      'INGESTION_GROQ_CONFIDENCE_THRESHOLD',
    ],
  },

  'validate-rows': {
    slug: 'validate-rows',
    packaging: 'zip',
    memoryMb: 512,
    timeoutSeconds: 60,
    env: [...BASE_ENV, ...PIPELINE_ENV],
  },

  enrich: {
    slug: 'enrich',
    packaging: 'zip',
    memoryMb: 512,
    timeoutSeconds: 60,
    env: [...BASE_ENV, ...PIPELINE_ENV],
  },

  embed: {
    slug: 'embed',
    // The MiniLM ONNX model is ~90MB against a 250MB unzipped layer cap, and
    // @xenova/transformers brings its own runtime on top.
    packaging: 'image',
    // Lambda scales CPU with memory and inference is CPU-bound: this is the
    // one function where memory buys speed rather than headroom.
    memoryMb: 3008,
    // Cold start loads the model before the first row is embedded, and a
    // 250-row chunk follows it.
    timeoutSeconds: 300,
    env: [...BASE_ENV, ...PIPELINE_ENV, 'EMBEDDING_DISABLED'],
  },

  load: {
    slug: 'load',
    packaging: 'zip',
    memoryMb: 512,
    // Batched upsert, degrading to per-row isolation when a duplicate
    // registration is present — 250 individual statements in the worst case.
    timeoutSeconds: 120,
    env: [...BASE_ENV, ...PIPELINE_ENV],
  },

  'aggregate-results': {
    slug: 'aggregate-results',
    packaging: 'zip',
    memoryMb: 512,
    timeoutSeconds: 60,
    env: BASE_ENV,
  },

  'mark-job-failed': {
    slug: 'mark-job-failed',
    packaging: 'zip',
    memoryMb: 256,
    // Two writes. If this cannot finish in 30s the database is gone, and a
    // longer timeout only delays the operator learning that.
    timeoutSeconds: 30,
    env: BASE_ENV,
  },
};

/** Ordered as the pipeline runs them, for a deployment manifest that reads sensibly. */
export function configFor(stage: EtlStage): FunctionConfig | undefined {
  return FUNCTION_CONFIGS[stageSlug(stage)];
}
