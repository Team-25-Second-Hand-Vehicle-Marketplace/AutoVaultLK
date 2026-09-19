import type { SpecFilterDto } from '../dto/filter-search.dto';
import type {
  ConditionValue,
  FuelTypeValue,
  TransmissionTypeValue,
  VehicleTypeValue,
} from '../constants/vehicle-attributes.constants';

export const CONFIDENCE_THRESHOLD = 0.6;

export const TRIGRAM_THRESHOLD = 0.45;

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
