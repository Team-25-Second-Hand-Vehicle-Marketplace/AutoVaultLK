import { embedStage } from '../workers/etl-worker/pipeline/embed/embed.stage';
import type { ChunkEnvelope } from '../workers/etl-worker/pipeline/envelope';
import { runChunkStage } from './run-chunk-stage';

/**
 * Step Functions state: Embed. search_text and the 384-dimension vector.
 *
 * Packaged as a container image rather than a zip: the MiniLM ONNX model is
 * ~90MB and a layer caps at 250MB unzipped. Wants more memory than the other
 * stages too — Lambda scales CPU with memory, and inference is CPU-bound.
 */
export const handler = (envelope: ChunkEnvelope): Promise<ChunkEnvelope> =>
  runChunkStage(embedStage, envelope);
