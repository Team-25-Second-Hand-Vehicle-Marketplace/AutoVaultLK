import { EMBEDDING_DIMENSIONS } from './constants';

export function assertEmbedding(values: number[]): number[] {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimension ${values.length} != ${EMBEDDING_DIMENSIONS} (all-MiniLM-L6-v2)`,
    );
  }
  if (values.some((n) => !Number.isFinite(n))) {
    throw new Error('Embedding contains a non-finite value');
  }
  return values;
}

/** pgvector text form: '[0.1,0.2,...]'. Parameterize as $n::vector. */
export function toPgVector(values: number[]): string {
  return `[${assertEmbedding(values).join(',')}]`;
}

export function l2Normalize(values: number[]): number[] {
  const checked = assertEmbedding(values);
  let sumSquares = 0;
  for (const n of checked) sumSquares += n * n;
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return checked;
  return checked.map((n) => n / norm);
}
