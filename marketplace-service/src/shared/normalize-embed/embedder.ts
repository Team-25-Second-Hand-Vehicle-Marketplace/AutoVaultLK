import { EMBEDDING_MODEL_ID } from './constants';
import { assertEmbedding, l2Normalize } from './vector';

export type Embedder = {
  embed(text: string): Promise<number[]>;
};

type FeaturePipeline = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: ArrayLike<number> | BigInt64Array }>;

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
