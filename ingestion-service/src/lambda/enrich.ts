import { enrichStage } from '../workers/etl-worker/pipeline/enrich/enrich.stage';
import type { ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import { runChunkStage } from './run-chunk-stage';


export const handler = (envelope: ChunkEnvelope): Promise<ChunkEnvelope> =>
  runChunkStage(enrichStage, envelope);
