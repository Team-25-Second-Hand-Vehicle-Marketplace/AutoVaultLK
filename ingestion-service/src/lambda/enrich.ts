import { enrichStage } from '../workers/etl-worker/pipeline/enrich/enrich.stage';
import type { ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import { runChunkStage } from './run-chunk-stage';

/**
 * Step Functions state: Enrich. Defaults and the specs jsonb.
 *
 * Must precede Embed: buildSearchText reads specs.body_type, and a row
 * embedded before enrichment produces different text from the manual path
 * (FR-22.1).
 */
export const handler = (envelope: ChunkEnvelope): Promise<ChunkEnvelope> =>
  runChunkStage(enrichStage, envelope);
