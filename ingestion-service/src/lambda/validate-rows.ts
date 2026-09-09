import { validateRowsStage } from '../workers/etl-worker/pipeline/validate/validate-rows.stage';
import type { ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import { runChunkStage } from './run-chunk-stage';

/** Step Functions state: ValidateRows. The gate — every rejection reason originates here. */
export const handler = (envelope: ChunkEnvelope): Promise<ChunkEnvelope> =>
  runChunkStage(validateRowsStage, envelope);
