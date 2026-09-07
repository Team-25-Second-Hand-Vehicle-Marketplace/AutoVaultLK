import { ConfigService } from '@nestjs/config';
import type { PipelineConfig } from '../workers/etl-worker/pipeline/types';

/** Mirrors the Step Functions Map state's MaxConcurrency (SAD §6.6 / ADR-003). */
export const DEFAULT_MAX_CONCURRENCY = 10;
export const DEFAULT_CHUNK_SIZE = 250;
/** Below this, parseNormalize routes a row to the Groq fallback (SAD §3.6.2). */
export const DEFAULT_GROQ_CONFIDENCE_THRESHOLD = 0.6;
export const DEFAULT_MAX_UPLOAD_MB = 25;

export function pipelineConfig(config: ConfigService): PipelineConfig {
  return {
    maxConcurrency: positiveIntOr(
      config,
      'INGESTION_MAX_CONCURRENCY',
      DEFAULT_MAX_CONCURRENCY,
    ),
    chunkSize: positiveIntOr(config, 'INGESTION_CHUNK_SIZE', DEFAULT_CHUNK_SIZE),
    groqConfidenceThreshold: unitIntervalOr(
      config,
      'INGESTION_GROQ_CONFIDENCE_THRESHOLD',
      DEFAULT_GROQ_CONFIDENCE_THRESHOLD,
    ),
    // Exact string only: any other value (including "TRUE") leaves embeddings
    // enabled, so a typo cannot silently ship listings with no vector.
    embeddingDisabled: config.get<string>('EMBEDDING_DISABLED') === 'true',
  };
}

export function maxUploadBytes(config: ConfigService): number {
  return (
    positiveIntOr(config, 'INGESTION_MAX_UPLOAD_MB', DEFAULT_MAX_UPLOAD_MB) * 1024 * 1024
  );
}

/**
 * A concurrency or chunk size of 0 would stall the pipeline rather than fail
 * loudly, so anything non-positive or unparseable falls back to the default.
 */
function positiveIntOr(config: ConfigService, key: string, fallback: number): number {
  const parsed = Number.parseInt(config.get<string>(key) ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Confidence is a probability; anything outside [0,1] is a misconfiguration. */
function unitIntervalOr(config: ConfigService, key: string, fallback: number): number {
  const parsed = Number.parseFloat(config.get<string>(key) ?? '');
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}
