import { EMBEDDING_MODEL_ID } from './constants';
import { assertEmbedding, l2Normalize } from './vector';

export type Embedder = {
  embed(text: string): Promise<number[]>;
};

type FeaturePipeline = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: ArrayLike<number> | BigInt64Array }>;

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
      return l2Normalize(assertEmbedding(toNumbers(output.data)));
    },
  };
}

/**
 * feature-extraction returns float data, but the Tensor type also admits
 * BigInt64Array for integer-output tasks. Narrowing here keeps assertEmbedding
 * working on plain numbers instead of silently producing bigints, which would
 * fail Number.isFinite and surface as a confusing dimension error.
 */
function toNumbers(data: ArrayLike<number> | BigInt64Array): number[] {
  return data instanceof BigInt64Array
    ? Array.from(data, (n) => Number(n))
    : Array.from(data);
}

async function loadPipeline(): Promise<FeaturePipeline> {
  const mod = await import('@xenova/transformers');
  return (await mod.pipeline(
    'feature-extraction',
    EMBEDDING_MODEL_ID,
  )) as unknown as FeaturePipeline;
}
