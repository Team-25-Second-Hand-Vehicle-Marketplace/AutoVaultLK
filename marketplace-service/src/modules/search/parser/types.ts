import type { SpecFilterDto } from '../dto/filter-search.dto';
import type {
  ConditionValue,
  FuelTypeValue,
  TransmissionTypeValue,
  VehicleTypeValue,
} from '../constants/vehicle-attributes.constants';

/** SAD 3.6.2 / FR-21.2: Groq is only considered below this coverage ratio. */
export const CONFIDENCE_THRESHOLD = 0.6;

/** pg_trgm default is 0.3; makes/models need a tighter gate to avoid junk hits. */
export const TRIGRAM_THRESHOLD = 0.45;

export type ParserToken = {
  text: string;
  /** Lowercased, punctuation-stripped form used for dictionary lookup. */
  norm: string;
  stopword: boolean;
  /** Neighbour is numeric. Stage 4 rejects these as makes/models (SAD 6.7). */
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

/**
 * Output of the deterministic parser (SAD 4.1.4 / FR-21).
 * Next steps consume `filters` as a FilterSearchDto and `semanticText` as
 * the MiniLM input. Groq only sees `unresolvedTokens` when needsGroqFallback.
 */
export type ParsedQuery = {
  filters: ExtractedFilters;
  semanticText: string;
  unresolvedTokens: string[];
  confidence: number;
  needsGroqFallback: boolean;
  consumedCount: number;
  meaningfulCount: number;
};
