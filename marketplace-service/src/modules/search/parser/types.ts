import type { SpecFilterDto } from '../dto/filter-search.dto';
import type {
  ConditionValue,
  FuelTypeValue,
  TransmissionTypeValue,
  VehicleTypeValue,
} from '../constants/vehicle-attributes.constants';

export const CONFIDENCE_THRESHOLD = 0.6;

export const TRIGRAM_THRESHOLD = 0.45;

/**
 * How far the best fuzzy candidate must beat the runner-up before it is
 * trusted.
 *
 * Without it, "Corola" scoring 0.72 against Corolla and 0.71 against Corsa
 * resolves to whichever the scan happened to see first — a coin flip. Below
 * the margin the value is left unresolved instead.
 *
 * Shared deliberately: ingestion-service's dictionary-snapshot.ts pins the
 * same number, so both halves of the platform refuse the same ambiguous
 * matches. Changing it here without changing it there reintroduces the drift
 * the parity test exists to catch.
 */
export const AMBIGUITY_MARGIN = 0.05;

export type ParserToken = {
  text: string;

  norm: string;
  stopword: boolean;

  digitAdjacent: boolean;
  consumed: boolean;
};

export type DictionaryEntry = {
  canonical: string;
  aliases: string[];
  vehicleTypes: string[];
  parentCanonical?: string;
};

export type ParserVocabulary = {
  makes: DictionaryEntry[];
  models: DictionaryEntry[];
  bodyTypes: DictionaryEntry[];
};

export type ExtractedFilters = {
  vehicleType?: VehicleTypeValue[];
  make?: string[];
  model?: string[];
  condition?: ConditionValue[];
  fuelType?: FuelTypeValue[];
  transmissionType?: TransmissionTypeValue[];
  minPrice?: number;
  maxPrice?: number;
  minYear?: number;
  maxYear?: number;
  minMileage?: number;
  maxMileage?: number;
  specs?: SpecFilterDto[];
};

export type ParsedQuery = {
  filters: ExtractedFilters;
  semanticText: string;
  unresolvedTokens: string[];
  confidence: number;
  needsGroqFallback: boolean;
  consumedCount: number;
  meaningfulCount: number;
};
