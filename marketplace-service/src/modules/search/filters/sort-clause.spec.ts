import { EMBEDDING_DIMENSIONS } from '../../../shared/normalize-embed';
import { buildOrderBy } from './sort-clause';

function unitVector(): number[] {
  const values = new Array(EMBEDDING_DIMENSIONS).fill(0);
  values[0] = 1;
  return values;
}

describe('buildOrderBy', () => {
  it('ranks by cosine distance when a query embedding is present (FR-23)', () => {
    const params: unknown[] = ['LIVE'];
    const sql = buildOrderBy('relevance', params, { queryEmbedding: unitVector() });
    expect(sql).toBe('v.embedding <=> $2::vector ASC NULLS LAST, v.created_at DESC');
    expect(String(params[1])).toMatch(/^\[1,0,/);
  });

  it('falls back to ts_rank when there is leftover keyword text but no vector', () => {
    const params: unknown[] = ['LIVE'];
    const sql = buildOrderBy('relevance', params, { keyword: 'leather' });
    expect(sql).toBe(
      "ts_rank(v.search_vector, plainto_tsquery('english', $2)) DESC, v.created_at DESC",
    );
    expect(params[1]).toBe('leather');
  });

  it('skips both rankers when the query resolved to filters only (NFR-12.1)', () => {
    const params: unknown[] = ['LIVE'];
    expect(buildOrderBy('relevance', params, {})).toBe('v.created_at DESC');
    expect(params).toEqual(['LIVE']);
  });

  it('honours an explicit scalar sort even if an embedding was produced', () => {
    const params: unknown[] = [];
    expect(buildOrderBy('price_asc', params, { queryEmbedding: unitVector() })).toBe('v.price ASC');
    expect(params).toEqual([]);
  });
});
