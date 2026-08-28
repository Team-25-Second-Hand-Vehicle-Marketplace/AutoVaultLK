import type { ParserToken } from './types';

export const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'from',
  'than',
  'me',
  'my',
  'i',
  'im',
  'looking',
  'look',
  'want',
  'wanted',
  'need',
  'needed',
  'please',
  'show',
  'find',
  'search',
  'get',
  'any',
  'some',
  'around',
  'about',
  'approx',
  'approximately',
  'lkr',
  'rs',
  'rupees',
]);

const NUMERIC = /^(?:\d+(?:\.\d+)?)(?:k|m|million|km|kms)?$/;

export function isNumericToken(norm: string): boolean {
  return NUMERIC.test(norm);
}

export function tokenize(raw: string): ParserToken[] {
  const lowered = raw.toLowerCase().trim();
  const spaced = lowered
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^a-z0-9.+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!spaced) return [];

  const tokens: ParserToken[] = spaced.split(' ').map((text) => {
    const norm = text.replace(/^\.+|\.+$/g, '');
    return {
      text,
      norm,
      stopword: STOPWORDS.has(norm),
      digitAdjacent: false,
      consumed: false,
    };
  });

  markDigitAdjacent(tokens);
  return tokens;
}

function markDigitAdjacent(tokens: ParserToken[]): void {
  for (let i = 0; i < tokens.length; i++) {
    const prev = nearestMeaningful(tokens, i, -1);
    const next = nearestMeaningful(tokens, i, 1);
    tokens[i].digitAdjacent =
      (!!prev && isNumericToken(prev.norm)) || (!!next && isNumericToken(next.norm));
  }
}

function nearestMeaningful(
  tokens: ParserToken[],
  from: number,
  step: -1 | 1,
): ParserToken | undefined {
  for (let i = from + step; i >= 0 && i < tokens.length; i += step) {
    if (!tokens[i].stopword) return tokens[i];
  }
  return undefined;
}
