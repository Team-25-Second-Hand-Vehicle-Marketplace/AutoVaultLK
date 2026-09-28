import { embedStage } from '../workers/etl-worker/pipeline/embed/embed.stage';
import type { ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import { runChunkStage } from './run-chunk-stage';


export const handler = (envelope: ChunkEnvelope): Promise<ChunkEnvelope> =>
  runChunkStage(embedStage, envelope);
