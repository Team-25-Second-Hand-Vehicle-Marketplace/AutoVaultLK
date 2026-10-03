import type { EtlStage } from '../../../infrastructure/database/entities/etl-stage-log.entity';


/** Run once for the whole file, before any fan-out. */
export const FILE_STAGES: readonly EtlStage[] = ['VALIDATE_FILE', 'SPLIT_CHUNKS'];

export const CHUNK_STAGES: readonly EtlStage[] = [
  'PARSE_NORMALIZE',
  'GROQ_NORMALIZE',
  'VALIDATE_ROWS',
  'ENRICH',
  'EMBED',
  'LOAD',
];

/** Run once after the Map completes. */
export const FINALIZE_STAGES: readonly EtlStage[] = ['AGGREGATE', 'NOTIFY'];

export const IMAGE_STAGES: readonly EtlStage[] = ['PROCESS_IMAGES'];

/** Every stage, for exhaustiveness checks. */
export const ALL_STAGES: readonly EtlStage[] = [
  ...FILE_STAGES,
  ...CHUNK_STAGES,
  ...IMAGE_STAGES,
  ...FINALIZE_STAGES,
];

/**
 * `PARSE_NORMALIZE` -> `parse-normalize`.
 *
 * The Lambda directory names under src/lambda/ and the ASL state names both
 * derive from this, so a stage added to CHUNK_STAGES has exactly one spelling.
 */
export function stageSlug(stage: EtlStage): string {
  return stage.toLowerCase().replace(/_/g, '-');
}
