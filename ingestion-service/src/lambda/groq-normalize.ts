import { groqNormalizeStage } from '../workers/etl-worker/pipeline/normalize/groq-normalize.stage';
import type { ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import { runChunkStage } from './run-chunk-stage';

/**
 * Step Functions state: GroqNormalize. The LLM fallback for rows the
 * dictionary could not resolve.
 *
 * Logs SKIPPED and passes rows through when GROQ_API_KEY is unset — required
 * behaviour, not a degradation, since a dealer upload cannot fail because a
 * third party is unreachable.
 */
export const handler = (envelope: ChunkEnvelope): Promise<ChunkEnvelope> =>
  runChunkStage(groqNormalizeStage, envelope);
