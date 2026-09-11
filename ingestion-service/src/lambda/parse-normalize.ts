import { parseNormalizeStage } from '../workers/etl-worker/pipeline/normalize/parse-normalize.stage';
import type { ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import { runChunkStage } from './run-chunk-stage';

/** Step Functions state: ParseNormalize. Coerces cells and resolves the dictionary. */
export const handler = (envelope: ChunkEnvelope): Promise<ChunkEnvelope> =>
  runChunkStage(parseNormalizeStage, envelope);
