import { trigramSimilarity } from '../../../../src/modules/search/parser/trigram';

describe('trigramSimilarity', () => {
  it('returns 1 for an identical string', () => {
    expect(trigramSimilarity('toyota', 'toyota')).toBe(1);
  });

  it('returns 0 for completely dissimilar strings', () => {
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
  });

  it('returns 0 when either input is empty', () => {
    expect(trigramSimilarity('', 'toyota')).toBe(0);
    expect(trigramSimilarity('toyota', '')).toBe(0);
  });

  it('gives a high score to a near-miss typo', () => {
    expect(trigramSimilarity('toyata', 'toyota')).toBeGreaterThan(0.5);
  });

  it('is symmetric', () => {
    expect(trigramSimilarity('honda', 'hond')).toBeCloseTo(trigramSimilarity('hond', 'honda'));
  });

  it('reproduces the documented volkswagon/wagon collision score', () => {
    // deterministic-parser.ts's own comment cites 0.4706 for this exact pair —
    // this pins the shared trigram implementation to that number directly.
    expect(trigramSimilarity('volkswagon', 'wagon')).toBeCloseTo(0.4706, 3);
  });
});
