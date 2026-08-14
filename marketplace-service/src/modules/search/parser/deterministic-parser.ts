import { extractNumeric } from './numeric';
import { tokenize } from './tokenize';
import { CONFIDENCE_THRESHOLD } from './types';
import type {
  DictionaryEntry,
  ExtractedFilters,
  ParsedQuery,
  ParserToken,
  ParserVocabulary,
} from './types';
import {
  consumeSpan,
  exactClosedHit,
  exactSpanHit,
  fuzzyClosedHit,
  fuzzySpanHit,
  indexEntries,
  isBodyType,
  isCondition,
  isDriveType,
  isFuelType,
  isTransmission,
  isVehicleType,
  type ClosedField,
  type DictionaryIndex,
} from './vocabulary';

/**
 * Deterministic 5-stage parser (SAD 4.1.4 / §6.7 / FR-21).
 *
 * Pure function: vocabulary is injected so Jest can run without Postgres.
 * Groq, pgvector, and the HTTP route are intentionally not here — they
 * consume this output in later steps.
 */
export function parseQuery(raw: string, vocab: ParserVocabulary): ParsedQuery {
  const tokens = tokenize(raw);
  const filters: ExtractedFilters = {};
  const makes = indexEntries(vocab.makes);
  const models = indexEntries(vocab.models);
  const bodies = indexEntries(vocab.bodyTypes);

  stagePhrases(tokens, filters, makes, models, bodies);
  extractNumeric(tokens, filters);
  stageExact(tokens, filters, makes, models, bodies);
  stageFuzzy(tokens, filters, vocab);

  return finalize(tokens, filters);
}

function stagePhrases(
  tokens: ParserToken[],
  filters: ExtractedFilters,
  makes: DictionaryIndex,
  models: DictionaryIndex,
  bodies: DictionaryIndex,
): void {
  walk(tokens, (start) => {
    const closed = exactClosedHit(tokens, start, 3, 2);
    if (closed) {
      applyClosed(filters, closed.field, closed.value);
      consumeSpan(tokens, closed.start, closed.span);
      return closed.span;
    }
    const make = exactSpanHit(tokens, start, 3, makes, 2);
    if (make) {
      pushUnique(filters, 'make', make.entry.canonical);
      consumeSpan(tokens, make.start, make.span);
      return make.span;
    }
    const model = exactSpanHit(tokens, start, 3, models, 2);
    if (model && modelAllowed(filters, model.entry)) {
      applyModel(filters, model.entry);
      consumeSpan(tokens, model.start, model.span);
      return model.span;
    }
    const body = exactSpanHit(tokens, start, 3, bodies, 2);
    if (body && isBodyType(body.entry.canonical)) {
      addSpec(filters, 'body_type', body.entry.canonical);
      consumeSpan(tokens, body.start, body.span);
      return body.span;
    }
    return 0;
  });
}

function stageExact(
  tokens: ParserToken[],
  filters: ExtractedFilters,
  makes: DictionaryIndex,
  models: DictionaryIndex,
  bodies: DictionaryIndex,
): void {
  // SAD 6.7: strictly resolve Make before Model.
  walk(tokens, (start) => {
    const make = exactSpanHit(tokens, start, 3, makes, 1);
    if (make) {
      pushUnique(filters, 'make', make.entry.canonical);
      consumeSpan(tokens, make.start, make.span);
      return make.span;
    }
    return 0;
  });

  walk(tokens, (start) => {
    const model = exactSpanHit(tokens, start, 3, models, 1);
    if (model && modelAllowed(filters, model.entry)) {
      applyModel(filters, model.entry);
      consumeSpan(tokens, model.start, model.span);
      return model.span;
    }
    return 0;
  });

  walk(tokens, (start) => {
    const closed = exactClosedHit(tokens, start, 1, 1);
    if (closed) {
      applyClosed(filters, closed.field, closed.value);
      consumeSpan(tokens, closed.start, closed.span);
      return 1;
    }
    const body = exactSpanHit(tokens, start, 1, bodies, 1);
    if (body && isBodyType(body.entry.canonical) && !isVehicleType(body.entry.canonical)) {
      addSpec(filters, 'body_type', body.entry.canonical);
      consumeSpan(tokens, body.start, body.span);
      return 1;
    }
    return 0;
  });
}

function stageFuzzy(
  tokens: ParserToken[],
  filters: ExtractedFilters,
  vocab: ParserVocabulary,
): void {
  walk(tokens, (start) => {
    const make = fuzzySpanHit(tokens, start, 2, vocab.makes, {
      rejectDigitAdjacent: true,
    });
    if (make) {
      pushUnique(filters, 'make', make.entry.canonical);
      consumeSpan(tokens, make.start, make.span);
      return make.span;
    }
    return 0;
  });

  walk(tokens, (start) => {
    const allowed = vocab.models.filter((entry) => modelAllowed(filters, entry));
    const model = fuzzySpanHit(tokens, start, 2, allowed, {
      rejectDigitAdjacent: true,
    });
    if (model) {
      applyModel(filters, model.entry);
      consumeSpan(tokens, model.start, model.span);
      return model.span;
    }
    return 0;
  });

  // Small closed enums: type-gating does not apply (SAD 6.7 is for makes/models).
  walk(tokens, (start) => {
    const closed = fuzzyClosedHit(tokens, start);
    if (closed) {
      applyClosed(filters, closed.field, closed.value);
      consumeSpan(tokens, closed.start, closed.span);
      return 1;
    }
    const body = fuzzySpanHit(tokens, start, 1, vocab.bodyTypes, {
      rejectDigitAdjacent: false,
    });
    if (body && isBodyType(body.entry.canonical) && !isVehicleType(body.entry.canonical)) {
      addSpec(filters, 'body_type', body.entry.canonical);
      consumeSpan(tokens, body.start, body.span);
      return 1;
    }
    return 0;
  });
}

function walk(tokens: ParserToken[], tryAt: (start: number) => number): void {
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].consumed || tokens[i].stopword) {
      i += 1;
      continue;
    }
    const consumed = tryAt(i);
    i += consumed > 0 ? consumed : 1;
  }
}

function modelAllowed(filters: ExtractedFilters, entry: DictionaryEntry): boolean {
  if (!filters.make?.length) return true;
  if (!entry.parentCanonical) return true;
  return filters.make.includes(entry.parentCanonical);
}

function applyModel(filters: ExtractedFilters, entry: DictionaryEntry): void {
  pushUnique(filters, 'model', entry.canonical);
  if (entry.parentCanonical && !filters.make?.length) {
    pushUnique(filters, 'make', entry.parentCanonical);
  }
  if (!filters.vehicleType?.length && entry.vehicleTypes.length === 1) {
    const type = entry.vehicleTypes[0];
    if (isVehicleType(type)) pushUnique(filters, 'vehicleType', type);
  }
}

function applyClosed(filters: ExtractedFilters, field: ClosedField, value: string): void {
  if (field === 'vehicleType' && isVehicleType(value)) {
    pushUnique(filters, 'vehicleType', value);
    return;
  }
  if (field === 'condition' && isCondition(value)) {
    pushUnique(filters, 'condition', value);
    return;
  }
  if (field === 'fuelType' && isFuelType(value)) {
    pushUnique(filters, 'fuelType', value);
    return;
  }
  if (field === 'transmissionType' && isTransmission(value)) {
    pushUnique(filters, 'transmissionType', value);
    return;
  }
  if (field === 'driveType' && isDriveType(value)) {
    addSpec(filters, 'drive_type', value);
    return;
  }
  if (field === 'bodyType' && isBodyType(value) && !isVehicleType(value)) {
    addSpec(filters, 'body_type', value);
  }
}

function addSpec(filters: ExtractedFilters, key: string, value: string): void {
  const specs = filters.specs ?? [];
  if (specs.some((s) => s.key === key && s.value === value)) return;
  specs.push({ key, value });
  filters.specs = specs;
}

function pushUnique<K extends 'vehicleType' | 'make' | 'model' | 'condition' | 'fuelType' | 'transmissionType'>(
  filters: ExtractedFilters,
  key: K,
  value: NonNullable<ExtractedFilters[K]>[number],
): void {
  const current = (filters[key] as string[] | undefined) ?? [];
  if (current.includes(value as string)) return;
  (filters[key] as string[]) = [...current, value as string];
}

function finalize(tokens: ParserToken[], filters: ExtractedFilters): ParsedQuery {
  const meaningful = tokens.filter((t) => !t.stopword && t.norm);
  const unresolved = meaningful.filter((t) => !t.consumed).map((t) => t.norm);
  const consumedCount = meaningful.length - unresolved.length;
  const meaningfulCount = meaningful.length;
  const confidence =
    meaningfulCount === 0 ? 1 : round2(consumedCount / meaningfulCount);

  return {
    filters,
    semanticText: unresolved.join(' '),
    unresolvedTokens: unresolved,
    confidence,
    needsGroqFallback: confidence < CONFIDENCE_THRESHOLD,
    consumedCount,
    meaningfulCount,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
