import { isNumericToken, tokenize } from '../../../../src/modules/search/parser/tokenize';

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric characters', () => {
    const tokens = tokenize('Toyota Aqua 2018!');
    expect(tokens.map((t) => t.text)).toEqual(['toyota', 'aqua', '2018']);
  });

  it('returns an empty array for an empty or whitespace-only string', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  it('strips thousands-separator commas inside a number', () => {
    const tokens = tokenize('under 1,500,000');
    expect(tokens.map((t) => t.norm)).toContain('1500000');
  });

  it('marks known stopwords', () => {
    const tokens = tokenize('looking for a car');
    const byNorm = Object.fromEntries(tokens.map((t) => [t.norm, t.stopword]));
    expect(byNorm.looking).toBe(true);
    expect(byNorm.for).toBe(true);
    expect(byNorm.a).toBe(true);
    expect(byNorm.car).toBe(false);
  });

  it('marks a token digitAdjacent when the nearest meaningful neighbour is numeric', () => {
    const tokens = tokenize('under 500k rupees');
    // "under" is not a stopword and sits directly before the numeric "500k"
    const under = tokens.find((t) => t.norm === 'under')!;
    expect(under.digitAdjacent).toBe(true);
  });

  it('skips over stopwords when looking for the nearest meaningful neighbour', () => {
    // "car" ... "for" (stopword) ... "500k" — "for" should not block car from
    // seeing 500k, but car itself is two tokens away so digitAdjacent should
    // reflect the true nearest non-stopword token, not the immediate one.
    const tokens = tokenize('car for 500k');
    const car = tokens.find((t) => t.norm === 'car')!;
    expect(car.digitAdjacent).toBe(true);
  });

  it('strips leading/trailing dots from a token norm (e.g. trailing sentence punctuation)', () => {
    const tokens = tokenize('toyota.');
    expect(tokens[0].norm).toBe('toyota');
  });

  it('initializes every token as unconsumed', () => {
    const tokens = tokenize('toyota aqua');
    expect(tokens.every((t) => t.consumed === false)).toBe(true);
  });
});

describe('isNumericToken', () => {
  it.each([
    ['500', true],
    ['8.5', true],
    ['8.5m', true],
    ['500k', true],
    ['95km', true],
    ['95kms', true],
    ['million', false],
    ['toyota', false],
    ['', false],
  ])('isNumericToken(%s) === %s', (input, expected) => {
    expect(isNumericToken(input)).toBe(expected);
  });
});
