import {
  CONDITIONS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  VEHICLE_TYPES,
} from '../constants/vehicle-attributes.constants';
import { KNOWN_SPEC_KEYS, type KnownSpecKey } from '../constants/known-spec-keys.constants';
import type { SpecFilterDto } from '../dto/filter-search.dto';
import type { DictionaryEntry, ExtractedFilters, ParserVocabulary } from '../parser/types';
import { compact } from '../parser/vocabulary';

const YEAR_MIN = 1980;
const YEAR_MAX = 2100;
const PRICE_MAX = 500_000_000;
const MILEAGE_MAX = 2_000_000;

export type WhitelistResult = {
  filters: ExtractedFilters;
  dropped: string[];
  consumedTokens: string[];
};


export function whitelistGroqOutput(
  raw: unknown,
  vocab: ParserVocabulary,
  unresolvedTokens: string[],
): WhitelistResult {
  const dropped: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { filters: {}, dropped: ['payload'], consumedTokens: [] };
  }

  const body = raw as Record<string, unknown>;
  const filtersRaw =
    body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
      ? (body.filters as Record<string, unknown>)
      : body;

  const filters: ExtractedFilters = {};
  const makes = indexByCompact(vocab.makes);
  const models = indexByCompact(vocab.models);

  const vehicleType = whitelistEnumArray(filtersRaw.vehicleType, new Set(VEHICLE_TYPES), 'vehicleType', dropped);
  if (vehicleType) filters.vehicleType = vehicleType as ExtractedFilters['vehicleType'];

  const make = whitelistDictionaryArray(filtersRaw.make, makes, 'make', dropped);
  if (make) filters.make = make;

  const model = whitelistModels(filtersRaw.model, models, filters.make, dropped);
  if (model) filters.model = model;

  const condition = whitelistEnumArray(filtersRaw.condition, new Set(CONDITIONS), 'condition', dropped);
  if (condition) filters.condition = condition as ExtractedFilters['condition'];

  const fuelType = whitelistEnumArray(filtersRaw.fuelType, new Set(FUEL_TYPES), 'fuelType', dropped);
  if (fuelType) filters.fuelType = fuelType as ExtractedFilters['fuelType'];

  const transmissionType = whitelistEnumArray(
    filtersRaw.transmissionType,
    new Set(TRANSMISSION_TYPES),
    'transmissionType',
    dropped,
  );
  if (transmissionType) {
    filters.transmissionType = transmissionType as ExtractedFilters['transmissionType'];
  }

  assignInt(filters, 'minPrice', filtersRaw.minPrice, 0, PRICE_MAX, dropped);
  assignInt(filters, 'maxPrice', filtersRaw.maxPrice, 0, PRICE_MAX, dropped);
  assignInt(filters, 'minYear', filtersRaw.minYear, YEAR_MIN, YEAR_MAX, dropped);
  assignInt(filters, 'maxYear', filtersRaw.maxYear, YEAR_MIN, YEAR_MAX, dropped);
  assignInt(filters, 'minMileage', filtersRaw.minMileage, 0, MILEAGE_MAX, dropped);
  assignInt(filters, 'maxMileage', filtersRaw.maxMileage, 0, MILEAGE_MAX, dropped);

  const specs = whitelistSpecs(filtersRaw.specs, dropped);
  if (specs) filters.specs = specs;

  const allowedUnresolved = new Set(unresolvedTokens.map((t) => t.toLowerCase()));
  const consumedTokens = asStringArray(body.consumedTokens).filter((token) => {
    if (allowedUnresolved.has(token.toLowerCase())) return true;
    dropped.push(`consumedTokens:${token}`);
    return false;
  });

  return { filters, dropped, consumedTokens };
}

/** Rules-parsed fields always win (ADR-004: Groq fills unresolved gaps only). */
export function mergeFilters(rules: ExtractedFilters, groq: ExtractedFilters): ExtractedFilters {
  const merged: ExtractedFilters = { ...groq };

  if (rules.vehicleType?.length) merged.vehicleType = rules.vehicleType;
  if (rules.make?.length) merged.make = rules.make;
  if (rules.model?.length) merged.model = rules.model;
  if (rules.condition?.length) merged.condition = rules.condition;
  if (rules.fuelType?.length) merged.fuelType = rules.fuelType;
  if (rules.transmissionType?.length) merged.transmissionType = rules.transmissionType;

  if (rules.minPrice !== undefined) merged.minPrice = rules.minPrice;
  if (rules.maxPrice !== undefined) merged.maxPrice = rules.maxPrice;
  if (rules.minYear !== undefined) merged.minYear = rules.minYear;
  if (rules.maxYear !== undefined) merged.maxYear = rules.maxYear;
  if (rules.minMileage !== undefined) merged.minMileage = rules.minMileage;
  if (rules.maxMileage !== undefined) merged.maxMileage = rules.maxMileage;

  merged.specs = mergeSpecs(groq.specs, rules.specs);
  if (!merged.specs?.length) delete merged.specs;

  return merged;
}

function mergeSpecs(
  groq: SpecFilterDto[] | undefined,
  rules: SpecFilterDto[] | undefined,
): SpecFilterDto[] | undefined {
  const byKey = new Map<string, SpecFilterDto>();
  for (const spec of groq ?? []) byKey.set(spec.key, spec);
  for (const spec of rules ?? []) byKey.set(spec.key, spec);
  const specs = [...byKey.values()];
  return specs.length ? specs : undefined;
}

function indexByCompact(entries: DictionaryEntry[]): Map<string, DictionaryEntry> {
  const map = new Map<string, DictionaryEntry>();
  for (const entry of entries) {
    map.set(compact(entry.canonical), entry);
    for (const alias of entry.aliases) map.set(compact(alias), entry);
  }
  return map;
}

function whitelistEnumArray(
  value: unknown,
  allowed: Set<string>,
  field: string,
  dropped: string[],
): string[] | undefined {
  const items = asStringArray(value);
  if (items.length === 0) return undefined;
  const kept: string[] = [];
  for (const item of items) {
    const normalized = item.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (allowed.has(normalized)) kept.push(normalized);
    else dropped.push(`${field}:${item}`);
  }
  return unique(kept);
}

function whitelistDictionaryArray(
  value: unknown,
  index: Map<string, DictionaryEntry>,
  field: string,
  dropped: string[],
): string[] | undefined {
  const items = asStringArray(value);
  if (items.length === 0) return undefined;
  const kept: string[] = [];
  for (const item of items) {
    const hit = index.get(compact(item));
    if (hit) kept.push(hit.canonical);
    else dropped.push(`${field}:${item}`);
  }
  return unique(kept);
}

function whitelistModels(
  value: unknown,
  index: Map<string, DictionaryEntry>,
  makes: string[] | undefined,
  dropped: string[],
): string[] | undefined {
  const items = asStringArray(value);
  if (items.length === 0) return undefined;
  const kept: string[] = [];
  for (const item of items) {
    const hit = index.get(compact(item));
    if (!hit) {
      dropped.push(`model:${item}`);
      continue;
    }
    if (makes?.length && hit.parentCanonical && !makes.includes(hit.parentCanonical)) {
      dropped.push(`model:${item}`);
      continue;
    }
    kept.push(hit.canonical);
  }
  return unique(kept);
}

function whitelistSpecs(value: unknown, dropped: string[]): SpecFilterDto[] | undefined {
  if (!Array.isArray(value)) {
    if (value !== undefined) dropped.push('specs');
    return undefined;
  }
  const kept: SpecFilterDto[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      dropped.push('specs:malformed');
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const key = typeof rec.key === 'string' ? rec.key : '';
    const specValue = rec.value;
    const def = KNOWN_SPEC_KEYS[key as KnownSpecKey];
    if (!def) {
      dropped.push(`specs:${key || 'unknown'}`);
      continue;
    }
    const asString = specValue === undefined || specValue === null ? '' : String(specValue);
    if (def.type === 'enum') {
      if ((def.values as readonly string[]).includes(asString)) {
        kept.push({ key, value: asString });
      } else {
        dropped.push(`specs:${key}:${asString}`);
      }
      continue;
    }
    if (def.type === 'int') {
      const n = Number(asString);
      if (Number.isInteger(n) && n >= def.min && n <= def.max) {
        kept.push({ key, value: String(n) });
      } else {
        dropped.push(`specs:${key}:${asString}`);
      }
      continue;
    }
    if (asString === 'true' || asString === 'false') kept.push({ key, value: asString });
    else dropped.push(`specs:${key}:${asString}`);
  }
  return kept.length ? kept : undefined;
}

function assignInt(
  filters: ExtractedFilters,
  field: keyof Pick<
    ExtractedFilters,
    'minPrice' | 'maxPrice' | 'minYear' | 'maxYear' | 'minMileage' | 'maxMileage'
  >,
  value: unknown,
  min: number,
  max: number,
  dropped: string[],
): void {
  if (value === undefined || value === null || value === '') return;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    dropped.push(`${field}:${String(value)}`);
    return;
  }
  filters[field] = n;
}

function asStringArray(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

function unique(items: string[]): string[] | undefined {
  const out = [...new Set(items)];
  return out.length ? out : undefined;
}
