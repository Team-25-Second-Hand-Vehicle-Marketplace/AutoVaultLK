import type { EtlStage } from '../../../infrastructure/database/entities/etl-stage-log.entity';

/**
 * The pipeline's shape, declared once.
 *
 * Two executors run this graph: `LocalOrchestrator` in process, and a Step
 * Functions state machine in AWS. Nothing else would stop them drifting — and
 * the drift is silent in the worst direction, because local tests would pass
 * while the deployed pipeline skipped a stage.
 *
 * Both read these arrays. A test asserts the ASL definition's states match
 * them in order, so adding a stage to one without the other fails the build
 * rather than a dealer's upload.
 */

/** Run once for the whole file, before any fan-out. */
export const FILE_STAGES: readonly EtlStage[] = ['VALIDATE_FILE', 'SPLIT_CHUNKS'];

/**
 * Run per chunk, in this order, inside the Map state.
 *
 * Order is load-bearing, not cosmetic:
 * - GROQ_NORMALIZE must follow PARSE_NORMALIZE, which is what assigns the
 *   confidence it selects on.
 * - VALIDATE_ROWS must follow both, so a Groq repair gets a chance before the
 *   gate sees the row.
 * - ENRICH must precede EMBED: buildSearchText reads specs.body_type, and a
 *   row embedded before enrichment produces different text from the manual
 *   path (FR-22.1).
 * - LOAD is last and terminates the chain; nothing consumes its output rows.
 */
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

/**
 * Stages the image branch runs, as a Parallel state's second branch
 * alongside the chunk Map — not sequentially after it. Photos come from the
 * ZIP and depend on nothing in the text pipeline, so running the two
 * concurrently cuts wall-clock time on a large upload instead of paying for
 * image processing on top of the Map's duration.
 *
 * The cost of running concurrently: a vehicle row this branch needs to match
 * a photo against may not exist yet, since LOAD for that row's chunk may
 * still be running. ProcessJobImagesService's registration-number lookup
 * retries with a bounded budget for exactly this reason (see its own header
 * comment) rather than requiring the row to already exist — a design choice
 * over the alternative of a staging table plus a post-Map reconciliation
 * join, made because it needs no schema change and self-corrects once the
 * row lands.
 */
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
