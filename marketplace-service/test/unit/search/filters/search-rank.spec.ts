import { EMBEDDING_DIMENSIONS } from '../../../../src/shared/normalize-embed';
import {
  LAST_RESORT_WORD_SIMILARITY,
  appendTrigramWhere,
  chooseSearchRank,
  hasResolvedFilters,
} from '../../../../src/modules/search/filters/search-rank';

describe('hasResolvedFilters', () => {
  it('is false when the parser extracted nothing', () => {
    expect(hasResolvedFilters({})).toBe(false);
  });

  it('is true for a numeric ceiling alone', () => {
    expect(hasResolvedFilters({ maxPrice: 8_500_000 })).toBe(true);
  });
});

describe('chooseSearchRank', () => {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  vector[0] = 1;

  it('prefers a query embedding over trigram (FR-23)', () => {
    const result = chooseSearchRank({
      filters: {},
      semanticText: 'leather',
      rawQuery: 'leather seats',
      queryEmbedding: vector,
    });
    expect(result.usedSemanticRanking).toBe(true);
    expect(result.usedTrigramFallback).toBe(false);
    expect(result.rank?.queryEmbedding).toBe(vector);
  });

  it('ranks leftovers with trigram among resolved filters when MiniLM is down', () => {
    const result = chooseSearchRank({
      filters: { make: ['Toyota'] },
      semanticText: 'leather',
      rawQuery: 'toyota leather',
      queryEmbedding: null,
    });
    expect(result.usedTrigramFallback).toBe(true);
    expect(result.rank).toEqual({ trigramQuery: 'leather' });
    expect(result.rank?.trigramWhere).toBeUndefined();
  });

  it('gates retrieval on search_text when nothing resolved (last-resort)', () => {
    const result = chooseSearchRank({
      filters: {},
      semanticText: 'well maintained leather',
      rawQuery: 'well maintained leather',
      queryEmbedding: null,
    });
    expect(result.rank).toEqual({
      trigramQuery: 'well maintained leather',
      trigramWhere: true,
    });
  });

  it('skips both rankers when the query fully resolved to filters (NFR-12.1)', () => {
    const result = chooseSearchRank({
      filters: { make: ['Toyota'] },
      semanticText: '',
      rawQuery: 'toyota',
      queryEmbedding: null,
    });
    expect(result.rank).toBeUndefined();
    expect(result.usedSemanticRanking).toBe(false);
    expect(result.usedTrigramFallback).toBe(false);
  });
});

describe('appendTrigramWhere', () => {
  it('binds leftover text and the 0.3 threshold (never interpolates)', () => {
    const params: unknown[] = ['LIVE'];
    const where = appendTrigramWhere('v.status = $1', params, {
      trigramQuery: 'leather',
      trigramWhere: true,
    });
    expect(where).toBe(
      "v.status = $1 AND word_similarity($2, COALESCE(v.search_text, '')) >= $3",
    );
    expect(params).toEqual(['LIVE', 'leather', LAST_RESORT_WORD_SIMILARITY]);
  });

  it('does not gate retrieval when trigram is ranking-only', () => {
    const params: unknown[] = ['LIVE'];
    expect(appendTrigramWhere('v.status = $1', params, { trigramQuery: 'leather' })).toBe(
      'v.status = $1',
    );
    expect(params).toEqual(['LIVE']);
  });
});
