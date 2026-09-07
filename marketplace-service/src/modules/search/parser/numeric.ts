import { isNumericToken } from './tokenize';
import type { ExtractedFilters, ParserToken } from './types';

const MAX_OPS = new Set([
  'under',
  'below',
  'less',
  'upto',
  'max',
  'maximum',
  'cheaper',
  'until',
  'within',
  'up',
]);

const MIN_OPS = new Set([
  'over',
  'above',
  'more',
  'from',
  'min',
  'minimum',
  'newer',
  'after',
  'since',
  'least',
]);

const MAX_YEAR_OPS = new Set(['older', 'before']);

const UNIT_WORDS = new Set(['million', 'mil', 'm', 'k', 'km', 'kms', 'mileage', 'milage']);

type Bound = 'min' | 'max' | 'exact';

type QuantityKind = 'year' | 'price' | 'mileage';

type ParsedNumber = {
  amount: number;
  unit?: string;
};

export function extractNumeric(tokens: ParserToken[], filters: ExtractedFilters): void {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].consumed) continue;

    if (tokens[i].norm === 'between') {
      if (tryBetween(tokens, i, filters)) continue;
    }

    const parsed = readNumber(tokens, i);
    if (!parsed) continue;

    const kind = classify(parsed.amount, parsed.unit, parsed.boundHint, parsed.op);
    if (!kind) continue;

    applyBound(filters, kind, parsed.amount, parsed.bound);
    for (let j = parsed.consumeFrom; j <= parsed.consumeTo; j++) {
      tokens[j].consumed = true;
    }
  }
}

function tryBetween(
  tokens: ParserToken[],
  start: number,
  filters: ExtractedFilters,
): boolean {
  const left = readNumber(tokens, nextMeaningful(tokens, start + 1));
  if (!left) return false;
  const right = readNumber(tokens, nextMeaningful(tokens, left.consumeTo + 1));
  if (!right) return false;

  const kind = classify(left.amount, left.unit ?? right.unit, 'price', left.op);
  if (!kind) return false;

  applyBound(filters, kind, Math.min(left.amount, right.amount), 'min');
  applyBound(filters, kind, Math.max(left.amount, right.amount), 'max');
  for (let j = start; j <= right.consumeTo; j++) {
    tokens[j].consumed = true;
  }
  return true;
}

function nextMeaningful(tokens: ParserToken[], from: number): number {
  for (let i = from; i < tokens.length; i++) {
    if (!tokens[i].consumed && !tokens[i].stopword) return i;
  }
  return tokens.length;
}

function readNumber(
  tokens: ParserToken[],
  index: number,
):
  | (ParsedNumber & {
      bound: Bound;
      boundHint: QuantityKind;
      op?: string;
      consumeFrom: number;
      consumeTo: number;
    })
  | undefined {
  if (index < 0 || index >= tokens.length || tokens[index].consumed) return undefined;

  const mag = parseMagnitude(tokens[index].norm);
  if (!mag) return undefined;

  let unit = mag.unit;
  let consumeTo = index;
  const next = tokens[index + 1];
  if (!unit && next && !next.consumed && UNIT_WORDS.has(next.norm)) {
    unit = next.norm;
    consumeTo = index + 1;
  }

  const opLookup = lookupOperator(tokens, index);
  const amount = scale(mag.n, unit);
  const bound = boundFromOp(opLookup?.op, mag.n, unit);
  const boundHint: QuantityKind =
    isYear(mag.n, unit) ? 'year' : unitIsMileage(unit) ? 'mileage' : 'price';

  return {
    amount,
    unit,
    bound,
    boundHint,
    op: opLookup?.op,
    consumeFrom: opLookup?.from ?? index,
    consumeTo,
  };
}

export function parseMagnitude(norm: string): { n: number; unit?: string } | undefined {
  const match = norm.match(/^(\d+(?:\.\d+)?)(k|m|mil|million|km|kms)?$/);
  if (!match) return undefined;
  return { n: Number(match[1]), unit: match[2] };
}

function scale(n: number, unit: string | undefined): number {
  if (unit === 'million' || unit === 'mil' || unit === 'm') return Math.round(n * 1_000_000);
  if (unit === 'k' || unit === 'km' || unit === 'kms') return Math.round(n * 1000);
  return Math.round(n);
}

function isYear(n: number, unit: string | undefined): boolean {
  return !unit && Number.isInteger(n) && n >= 1980 && n <= 2100;
}

function unitIsMileage(unit: string | undefined): boolean {
  return unit === 'km' || unit === 'kms' || unit === 'mileage' || unit === 'milage';
}

function classify(
  amount: number,
  unit: string | undefined,
  hint: QuantityKind,
  op: string | undefined,
): QuantityKind | undefined {
  if (unit === 'million' || unit === 'm') return 'price';
  if (unitIsMileage(unit)) return 'mileage';
  if (unit === 'k') {
    // "under 500k" is a price ceiling in LKR; bare "95k" is kilometres.
    if (op && (MAX_OPS.has(op) || MIN_OPS.has(op))) return 'price';
    return 'mileage';
  }
  if (hint === 'year' || (amount >= 1980 && amount <= 2100 && amount === Math.round(amount))) {
    return 'year';
  }
  if (amount >= 100_000) return 'price';
  return undefined;
}

function boundFromOp(op: string | undefined, raw: number, unit: string | undefined): Bound {
  if (op && MAX_YEAR_OPS.has(op)) return 'max';
  if (op && (MAX_OPS.has(op) || op === 'older')) return 'max';
  if (op && MIN_OPS.has(op)) return 'min';
  if (isYear(raw, unit)) return 'exact';
  // Unqualified price/mileage in a search bar is a budget / ceiling.
  return 'max';
}

function lookupOperator(
  tokens: ParserToken[],
  numberIndex: number,
): { op: string; from: number } | undefined {
  let op: string | undefined;
  let from = numberIndex;
  for (let i = numberIndex - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token.consumed) break;
    if (isNumericToken(token.norm)) break;
    if (MAX_OPS.has(token.norm) || MIN_OPS.has(token.norm) || MAX_YEAR_OPS.has(token.norm)) {
      op = token.norm;
      from = i;
      break;
    }
    if (token.stopword) continue;
    break;
  }
  if (!op) return undefined;
  return { op, from };
}

function applyBound(
  filters: ExtractedFilters,
  kind: QuantityKind,
  amount: number,
  bound: Bound,
): void {
  if (kind === 'year') {
    if (bound === 'min') filters.minYear = minNum(filters.minYear, amount);
    else if (bound === 'max') filters.maxYear = maxNum(filters.maxYear, amount);
    else {
      filters.minYear = minNum(filters.minYear, amount);
      filters.maxYear = maxNum(filters.maxYear, amount);
    }
    return;
  }
  if (kind === 'price') {
    if (bound === 'min') filters.minPrice = minNum(filters.minPrice, amount);
    else filters.maxPrice = maxNum(filters.maxPrice, amount);
    return;
  }
  if (bound === 'min') filters.minMileage = minNum(filters.minMileage, amount);
  else filters.maxMileage = maxNum(filters.maxMileage, amount);
}

function minNum(current: number | undefined, incoming: number): number {
  return current === undefined ? incoming : Math.min(current, incoming);
}

function maxNum(current: number | undefined, incoming: number): number {
  return current === undefined ? incoming : Math.max(current, incoming);
}
