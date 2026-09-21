import { EMBEDDING_DIMENSIONS, toPgVector } from '../../../../src/shared/normalize-embed';
import {
  LAST_RESORT_WORD_SIMILARITY,
  MAX_EMBEDDING_DISTANCE,
  appendTrigramWhere,
  chooseSearchRank,
  hasResolvedFilters,
  maxEmbeddingDistanceFor,
} from '../../../../src/modules/search/filters/search-rank';

describe('hasResolvedFilters', () => {
  it('is false when the parser extracted nothing', () => {
    expect(hasResolvedFilters({})).toBe(false);
  });

  it('is true for a numeric ceiling alone', () => {
    expect(hasResolvedFilters({ maxPrice: 8_500_000 })).toBe(true);
  });
});

describe('maxEmbeddingDistanceFor', () => {
  // Measured directly against seed data: a bare single word ("sporty")
  // embeds too noisily for the 0.7 multi-word cutoff to admit even its own
  // best match (distance 0.811 to a listing describing itself as "Sporty
  // hatch"), while a full sentence like "family friendly vehicle" is
  // precise enough that 0.7 already excludes an unrelated listing (0.595
  // vs an irrelevant one only means the cutoff has room to spare, it does
  // not mean an irrelevant match would slip through).
  it('gives a bare single word the loosest cutoff', () => {
    expect(maxEmbeddingDistanceFor('sporty')).toBe(0.85);
  });

  it('gives a two-word query a moderately loosened cutoff', () => {
    expect(maxEmbeddingDistanceFor('sporty hatchback')).toBe(0.78);
  });

  it('keeps the original 0.7 cutoff for three or more words', () => {
    expect(maxEmbeddingDistanceFor('family friendly vehicle')).toBe(MAX_EMBEDDING_DISTANCE);
  });

  it('treats empty/whitespace-only text as zero words (loosest cutoff)', () => {
    expect(maxEmbeddingDistanceFor('   ')).toBe(0.85);
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

  it('gates embedding retrieval when nothing else resolved (no bikes for "family friendly")', () => {
    const result = chooseSearchRank({
      filters: {},
      semanticText: 'family friendly vehicles',
      rawQuery: 'family friendly vehicles',
      queryEmbedding: vector,
    });
    expect(result.rank?.embeddingWhere).toBe(true);
  });

  it('does not gate embedding retrieval when other filters already resolved', () => {
    const result = chooseSearchRank({
      filters: { make: ['Toyota'] },
      semanticText: 'family friendly',
      rawQuery: 'toyota family friendly',
      queryEmbedding: vector,
    });
    expect(result.rank?.embeddingWhere).toBe(false);
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

  it('binds the query vector and distance cutoff when embeddingWhere is set', () => {
    const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
    vector[0] = 1;
    const params: unknown[] = ['LIVE'];
    const where = appendTrigramWhere('v.status = $1', params, {
      queryEmbedding: vector,
      embeddingWhere: true,
    });
    expect(where).toBe(
      "v.status = $1 AND v.embedding IS NOT NULL AND v.embedding <=> $2::vector <= $3",
    );
    expect(params).toEqual(['LIVE', toPgVector(vector), MAX_EMBEDDING_DISTANCE]);
  });

  it('uses the rank-provided maxEmbeddingDistance instead of the default when set', () => {
    const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
    vector[0] = 1;
    const params: unknown[] = ['LIVE'];
    appendTrigramWhere('v.status = $1', params, {
      queryEmbedding: vector,
      embeddingWhere: true,
      maxEmbeddingDistance: 0.85,
    });
    expect(params).toEqual(['LIVE', toPgVector(vector), 0.85]);
  });

  it('does not gate retrieval when embedding rank is ranking-only', () => {
    const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
    vector[0] = 1;
    const params: unknown[] = ['LIVE'];
    expect(appendTrigramWhere('v.status = $1', params, { queryEmbedding: vector })).toBe(
      'v.status = $1',
    );
    expect(params).toEqual(['LIVE']);
  });
});
