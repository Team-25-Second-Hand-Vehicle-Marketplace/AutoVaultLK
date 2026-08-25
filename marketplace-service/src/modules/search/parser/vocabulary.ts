import {
  CONDITIONS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  VEHICLE_TYPES,
  type ConditionValue,
  type FuelTypeValue,
  type TransmissionTypeValue,
  type VehicleTypeValue,
} from '../constants/vehicle-attributes.constants';
import { KNOWN_SPEC_KEYS } from '../constants/known-spec-keys.constants';
import { trigramSimilarity } from './trigram';
import { TRIGRAM_THRESHOLD } from './types';
import type { DictionaryEntry, ParserToken } from './types';
import { isNumericToken } from './tokenize';

/** Strip spaces/hyphens so "Land Cruiser", "land-cruiser", "landcruiser" share a key. */
export function compact(value: string): string {
  return value.toLowerCase().replace(/[\s.\-_/]+/g, '');
}

export type DictionaryIndex = Map<string, DictionaryEntry[]>;

export function indexEntries(entries: DictionaryEntry[]): DictionaryIndex {
  const map: DictionaryIndex = new Map();
  for (const entry of entries) {
    addKey(map, compact(entry.canonical), entry);
    for (const alias of entry.aliases) {
      addKey(map, compact(alias), entry);
    }
  }
  return map;
}

function addKey(map: DictionaryIndex, key: string, entry: DictionaryEntry): void {
  if (!key) return;
  const list = map.get(key);
  if (list) {
    if (!list.includes(entry)) list.push(entry);
  } else {
    map.set(key, [entry]);
  }
}

export type SpanHit = {
  start: number;
  span: number;
  entry: DictionaryEntry;
};

export function exactSpanHit(
  tokens: ParserToken[],
  start: number,
  maxSpan: number,
  index: DictionaryIndex,
  minSpan = 1,
): SpanHit | undefined {
  for (let span = maxSpan; span >= minSpan; span--) {
    if (!spanIsOpen(tokens, start, span)) continue;
    const key = compact(joinSpan(tokens, start, span));
    const matches = index.get(key);
    if (matches?.length === 1) {
      return { start, span, entry: matches[0] };
    }
    if (matches && matches.length > 1) {
      // Ambiguous compact form (rare). Prefer a unique canonical match.
      return undefined;
    }
  }
  return undefined;
}

export function fuzzySpanHit(
  tokens: ParserToken[],
  start: number,
  maxSpan: number,
  entries: DictionaryEntry[],
  options: { rejectDigitAdjacent: boolean; threshold?: number },
): SpanHit | undefined {
  const threshold = options.threshold ?? TRIGRAM_THRESHOLD;
  for (let span = maxSpan; span >= 1; span--) {
    if (!spanIsOpen(tokens, start, span)) continue;
    if (options.rejectDigitAdjacent && spanHasDigitAdjacent(tokens, start, span)) {
      continue;
    }
    const probe = compact(joinSpan(tokens, start, span));
    if (probe.length < 4) continue;

    let best: DictionaryEntry | undefined;
    let bestScore = 0;
    let runnerUp = 0;
    for (const entry of entries) {
      const score = bestSimilarity(probe, entry);
      if (score > bestScore) {
        runnerUp = bestScore;
        bestScore = score;
        best = entry;
      } else if (score > runnerUp) {
        runnerUp = score;
      }
    }
    if (best && bestScore >= threshold && bestScore - runnerUp >= 0.05) {
      return { start, span, entry: best };
    }
  }
  return undefined;
}

function bestSimilarity(probe: string, entry: DictionaryEntry): number {
  let best = trigramSimilarity(probe, compact(entry.canonical));
  for (const alias of entry.aliases) {
    best = Math.max(best, trigramSimilarity(probe, compact(alias)));
  }
  return best;
}

export function spanIsOpen(tokens: ParserToken[], start: number, span: number): boolean {
  if (start + span > tokens.length) return false;
  for (let i = start; i < start + span; i++) {
    const token = tokens[i];
    if (token.consumed || token.stopword || isNumericToken(token.norm) || !token.norm) {
      return false;
    }
  }
  return true;
}

/** Like spanIsOpen but allows numeric tokens so "4 wheel drive" can match. */
export function spanIsPresent(tokens: ParserToken[], start: number, span: number): boolean {
  if (start + span > tokens.length) return false;
  for (let i = start; i < start + span; i++) {
    const token = tokens[i];
    if (token.consumed || token.stopword || !token.norm) return false;
  }
  return true;
}

function spanHasDigitAdjacent(tokens: ParserToken[], start: number, span: number): boolean {
  for (let i = start; i < start + span; i++) {
    if (tokens[i].digitAdjacent) return true;
  }
  return false;
}

export function joinSpan(tokens: ParserToken[], start: number, span: number): string {
  return tokens
    .slice(start, start + span)
    .map((t) => t.norm)
    .join(' ');
}

export function consumeSpan(tokens: ParserToken[], start: number, span: number): void {
  for (let i = start; i < start + span; i++) {
    tokens[i].consumed = true;
  }
}

/**
 * Closed CHECK-constraint enums plus colloquial/misspelt forms.
 * These never live in vehicle_dictionaries (entity comment / SAD 9).
 */
export type ClosedField =
  | 'vehicleType'
  | 'condition'
  | 'fuelType'
  | 'transmissionType'
  | 'driveType'
  | 'bodyType';

export type ClosedEnumHit = {
  field: ClosedField;
  value: string;
  start: number;
  span: number;
};

type ClosedPhrase = { words: string[]; field: ClosedField; value: string };

const CLOSED_PHRASES: ClosedPhrase[] = [
  { words: ['three', 'wheeler'], field: 'vehicleType', value: 'THREE_WHEELER' },
  { words: ['heavy', 'machinery'], field: 'vehicleType', value: 'HEAVY_MACHINERY' },
  { words: ['tuk', 'tuk'], field: 'vehicleType', value: 'THREE_WHEELER' },
  { words: ['second', 'hand'], field: 'condition', value: 'USED' },
  { words: ['brand', 'new'], field: 'condition', value: 'NEW' },
  { words: ['pre', 'owned'], field: 'condition', value: 'USED' },
  { words: ['all', 'wheel', 'drive'], field: 'driveType', value: 'AWD' },
  { words: ['four', 'wheel', 'drive'], field: 'driveType', value: '4WD' },
  { words: ['4', 'wheel', 'drive'], field: 'driveType', value: '4WD' },
  { words: ['station', 'wagon'], field: 'bodyType', value: 'WAGON' },
  { words: ['double', 'cab'], field: 'bodyType', value: 'PICKUP' },

  // Ported from the earlier deterministic-parser prototype when it was
  // removed. Same rule as above: only compounds whose words are all
  // unmasked by the tokenizer. "plug in hybrid" is deliberately absent —
  // "in" is a stopword, so that spelling can never match a strict-adjacency
  // phrase; "plugin hybrid" is the form that survives tokenization.
  { words: ['heavy', 'equipment'], field: 'vehicleType', value: 'HEAVY_MACHINERY' },
  { words: ['pick', 'up'], field: 'vehicleType', value: 'PICKUP' },
  { words: ['re', 'conditioned'], field: 'condition', value: 'RECONDITIONED' },
  { words: ['semi', 'automatic'], field: 'transmissionType', value: 'SEMI_AUTOMATIC' },
  { words: ['semi', 'auto'], field: 'transmissionType', value: 'SEMI_AUTOMATIC' },
  { words: ['auto', 'transmission'], field: 'transmissionType', value: 'AUTOMATIC' },
  { words: ['automatic', 'transmission'], field: 'transmissionType', value: 'AUTOMATIC' },
  { words: ['manual', 'transmission'], field: 'transmissionType', value: 'MANUAL' },
  { words: ['petrol', 'hybrid'], field: 'fuelType', value: 'HYBRID' },
  { words: ['plugin', 'hybrid'], field: 'fuelType', value: 'HYBRID' },
  { words: ['fully', 'electric'], field: 'fuelType', value: 'ELECTRIC' },
  { words: ['front', 'wheel', 'drive'], field: 'driveType', value: 'FWD' },
  { words: ['rear', 'wheel', 'drive'], field: 'driveType', value: 'RWD' },
  { words: ['mini', 'van'], field: 'bodyType', value: 'MINIVAN' },
  { words: ['people', 'carrier'], field: 'bodyType', value: 'MINIVAN' },
  { words: ['single', 'cab'], field: 'bodyType', value: 'PICKUP' },
];

const CLOSED_SINGLES: Record<string, { field: ClosedField; value: string }> = {
  car: { field: 'vehicleType', value: 'CAR' },
  cars: { field: 'vehicleType', value: 'CAR' },
  bike: { field: 'vehicleType', value: 'BIKE' },
  bikes: { field: 'vehicleType', value: 'BIKE' },
  van: { field: 'vehicleType', value: 'VAN' },
  vans: { field: 'vehicleType', value: 'VAN' },
  truck: { field: 'vehicleType', value: 'TRUCK' },
  trucks: { field: 'vehicleType', value: 'TRUCK' },
  suv: { field: 'vehicleType', value: 'SUV' },
  suvs: { field: 'vehicleType', value: 'SUV' },
  bus: { field: 'vehicleType', value: 'BUS' },
  buses: { field: 'vehicleType', value: 'BUS' },
  threewheeler: { field: 'vehicleType', value: 'THREE_WHEELER' },
  lorry: { field: 'vehicleType', value: 'LORRY' },
  lorries: { field: 'vehicleType', value: 'LORRY' },
  pickup: { field: 'vehicleType', value: 'PICKUP' },
  pickups: { field: 'vehicleType', value: 'PICKUP' },
  tractor: { field: 'vehicleType', value: 'TRACTOR' },
  tractors: { field: 'vehicleType', value: 'TRACTOR' },
  heavymachinery: { field: 'vehicleType', value: 'HEAVY_MACHINERY' },

  new: { field: 'condition', value: 'NEW' },
  brandnew: { field: 'condition', value: 'NEW' },
  used: { field: 'condition', value: 'USED' },
  secondhand: { field: 'condition', value: 'USED' },
  preowned: { field: 'condition', value: 'USED' },
  reconditioned: { field: 'condition', value: 'RECONDITIONED' },
  recon: { field: 'condition', value: 'RECONDITIONED' },

  petrol: { field: 'fuelType', value: 'PETROL' },
  gasoline: { field: 'fuelType', value: 'PETROL' },
  diesel: { field: 'fuelType', value: 'DIESEL' },
  deisel: { field: 'fuelType', value: 'DIESEL' },
  disel: { field: 'fuelType', value: 'DIESEL' },
  deesel: { field: 'fuelType', value: 'DIESEL' },
  hybrid: { field: 'fuelType', value: 'HYBRID' },
  hyrbid: { field: 'fuelType', value: 'HYBRID' },
  hybird: { field: 'fuelType', value: 'HYBRID' },
  electric: { field: 'fuelType', value: 'ELECTRIC' },
  ev: { field: 'fuelType', value: 'ELECTRIC' },
  cng: { field: 'fuelType', value: 'CNG' },

  manual: { field: 'transmissionType', value: 'MANUAL' },
  automatic: { field: 'transmissionType', value: 'AUTOMATIC' },
  auto: { field: 'transmissionType', value: 'AUTOMATIC' },
  cvt: { field: 'transmissionType', value: 'CVT' },
  semiautomatic: { field: 'transmissionType', value: 'SEMI_AUTOMATIC' },
  tiptronic: { field: 'transmissionType', value: 'SEMI_AUTOMATIC' },

  fwd: { field: 'driveType', value: 'FWD' },
  rwd: { field: 'driveType', value: 'RWD' },
  awd: { field: 'driveType', value: 'AWD' },
  '4wd': { field: 'driveType', value: '4WD' },
  '4x4': { field: 'driveType', value: '4WD' },

  sedan: { field: 'bodyType', value: 'SEDAN' },
  saloon: { field: 'bodyType', value: 'SEDAN' },
  hatchback: { field: 'bodyType', value: 'HATCHBACK' },
  hatch: { field: 'bodyType', value: 'HATCHBACK' },
  wagon: { field: 'bodyType', value: 'WAGON' },
  coupe: { field: 'bodyType', value: 'COUPE' },
  convertible: { field: 'bodyType', value: 'CONVERTIBLE' },
  minivan: { field: 'bodyType', value: 'MINIVAN' },
  mpv: { field: 'bodyType', value: 'MINIVAN' },
  scooter: { field: 'bodyType', value: 'SCOOTER' },
  scooty: { field: 'bodyType', value: 'SCOOTER' },
  motorbike: { field: 'bodyType', value: 'MOTORBIKE' },
  motorcycle: { field: 'bodyType', value: 'MOTORBIKE' },
};

export function exactClosedHit(
  tokens: ParserToken[],
  start: number,
  maxSpan: number,
  minSpan = 1,
): ClosedEnumHit | undefined {
  for (let span = maxSpan; span >= Math.max(minSpan, 2); span--) {
    if (!spanIsPresent(tokens, start, span)) continue;
    const words = tokens.slice(start, start + span).map((t) => t.norm);
    const phrase = CLOSED_PHRASES.find(
      (p) => p.words.length === span && p.words.every((w, i) => w === words[i]),
    );
    if (phrase) {
      return { field: phrase.field, value: phrase.value, start, span };
    }
  }

  if (minSpan <= 1 && maxSpan >= 1 && spanIsOpen(tokens, start, 1)) {
    const single = CLOSED_SINGLES[compact(tokens[start].norm)];
    if (single) {
      return { field: single.field, value: single.value, start, span: 1 };
    }
  }
  return undefined;
}

/**
 * Closed enums need a tighter fuzzy gate than makes/models.
 *
 * CLOSED_SINGLES holds short, common English words (wagon, sedan, coupe,
 * van, bus, auto), so an unrelated query term collides with one far more
 * readily than with a brand name. "volkswagon" scored 0.4706 against
 * "wagon" — over the shared 0.45 threshold — and, with Volkswagen absent
 * from the make dictionary, nothing outscored it: the query resolved at
 * confidence 1.0 to body_type=WAGON, matched no listing, and the relaxation
 * ladder then showed all 80. Groq was never consulted because no token
 * looked unresolved.
 *
 * Unlike fuzzySpanHit this has no runner-up margin to fall back on (it scans
 * a flat alias map, not ranked dictionary entries), so the threshold is the
 * only guard. Measured separation: genuine misspellings of these words
 * ("sedn" 0.545, "hachback" 0.737, "convertable" 0.750, "pickpup" 0.667)
 * all sit at 0.545+, so 0.52 rejects the collision while keeping every real
 * typo. Raising the global TRIGRAM_THRESHOLD instead would break make/model
 * matches that legitimately land in the 0.45-0.52 band.
 */
const CLOSED_ENUM_THRESHOLD = 0.52;

export function fuzzyClosedHit(
  tokens: ParserToken[],
  start: number,
): ClosedEnumHit | undefined {
  if (!spanIsOpen(tokens, start, 1)) return undefined;
  const probe = compact(tokens[start].norm);
  if (probe.length < 4) return undefined;

  let best: ClosedEnumHit | undefined;
  let bestScore = 0;
  for (const [alias, hit] of Object.entries(CLOSED_SINGLES)) {
    if (alias.length < 4) continue;
    const score = trigramSimilarity(probe, compact(alias));
    if (score > bestScore) {
      bestScore = score;
      best = { field: hit.field, value: hit.value, start, span: 1 };
    }
  }
  if (best && bestScore >= CLOSED_ENUM_THRESHOLD) return best;
  return undefined;
}

const VEHICLE_TYPE_SET = new Set<string>(VEHICLE_TYPES);
const CONDITION_SET = new Set<string>(CONDITIONS);
const FUEL_SET = new Set<string>(FUEL_TYPES);
const TRANSMISSION_SET = new Set<string>(TRANSMISSION_TYPES);
const BODY_TYPE_SET = new Set<string>(KNOWN_SPEC_KEYS.body_type.values);
const DRIVE_TYPE_SET = new Set<string>(KNOWN_SPEC_KEYS.drive_type.values);

export function isVehicleType(value: string): value is VehicleTypeValue {
  return VEHICLE_TYPE_SET.has(value);
}

export function isCondition(value: string): value is ConditionValue {
  return CONDITION_SET.has(value);
}

export function isFuelType(value: string): value is FuelTypeValue {
  return FUEL_SET.has(value);
}

export function isTransmission(value: string): value is TransmissionTypeValue {
  return TRANSMISSION_SET.has(value);
}

export function isBodyType(value: string): boolean {
  return BODY_TYPE_SET.has(value);
}

export function isDriveType(value: string): boolean {
  return DRIVE_TYPE_SET.has(value);
}
