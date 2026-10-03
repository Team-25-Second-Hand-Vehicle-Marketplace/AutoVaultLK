import { groqNormalizeStage } from '../workers/etl-worker/pipeline/normalize/groq-normalize.stage';
import type { ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import { runChunkStage } from './run-chunk-stage';

export const handler = (envelope: ChunkEnvelope): Promise<ChunkEnvelope> =>
  runChunkStage(groqNormalizeStage, envelope);
