import { EMBEDDING_DIMENSIONS } from './constants';
import { assertEmbedding, l2Normalize, toPgVector } from './vector';

describe('normalize-embed vector helpers', () => {
  it('rejects a vector that is not 384-d', () => {
    expect(() => assertEmbedding([1, 2, 3])).toThrow(/384/);
  });

  it('formats a pgvector literal the ORDER BY clause can bind', () => {
    const values = new Array(EMBEDDING_DIMENSIONS).fill(0);
    values[0] = 1;
    expect(toPgVector(values)).toMatch(/^\[1,0,0,/);
    expect(toPgVector(values).endsWith(']')).toBe(true);
  });

  it('L2-normalizes so cosine distance on the HNSW index is well-defined', () => {
    const values = new Array(EMBEDDING_DIMENSIONS).fill(0);
    values[0] = 3;
    values[1] = 4;
    const unit = l2Normalize(values);
    const length = Math.hypot(unit[0], unit[1]);
    expect(length).toBeCloseTo(1);
    expect(unit[0]).toBeCloseTo(0.6);
    expect(unit[1]).toBeCloseTo(0.8);
  });
});
