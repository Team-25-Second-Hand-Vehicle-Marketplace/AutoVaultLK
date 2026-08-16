import { EMBEDDING_MODEL_ID } from './constants';
import { assertEmbedding, l2Normalize } from './vector';

export type Embedder = {
  embed(text: string): Promise<number[]>;
};

type FeaturePipeline = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: ArrayLike<number> }>;

/**
 * Lazy MiniLM embedder. The ~90 MB ONNX model loads on first call so unit
 * tests that inject a fake Embedder never download it.
 *
 * If `@xenova/transformers` is not installed, the import throws and
 * QueryEmbeddingService skips ranking (FR-24).
 */
export function createXenovaEmbedder(): Embedder {
  let pipeline: FeaturePipeline | undefined;

  return {
    async embed(text: string): Promise<number[]> {
      if (!pipeline) pipeline = await loadPipeline();
      const output = await pipeline(text, { pooling: 'mean', normalize: true });
      return l2Normalize(assertEmbedding(Array.from(output.data)));
    },
  };
}

async function loadPipeline(): Promise<FeaturePipeline> {
  const mod = await import('@xenova/transformers');
  return mod.pipeline('feature-extraction', EMBEDDING_MODEL_ID);
}
