import type { ExtractedFilters, ParserVocabulary } from '../parser/types';
import {
  CONDITIONS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  VEHICLE_TYPES,
} from '../constants/vehicle-attributes.constants';
import { KNOWN_SPEC_KEYS } from '../constants/known-spec-keys.constants';

export const GROQ_SYSTEM_PROMPT = `You extract structured vehicle-search filters from a Sri Lankan second-hand listing query.

Return ONLY a JSON object:
{"filters":{...},"consumedTokens":["..."]}

Rules:
- Fill only fields the deterministic parser missed. Do not invent values.
- makes/models must be copied exactly from the allowed lists.
- vehicleType/condition/fuelType/transmissionType must be copied exactly from the allowed enums.
- specs.key must be one of the allowed spec keys; enum specs.value must be an allowed value.
- Numeric fields are integers. Years 1980-2100. Prices in LKR. Mileage in km.
- consumedTokens must be a subset of unresolvedTokens that you used.
- If nothing can be extracted, return {"filters":{},"consumedTokens":[]}.`;

export function buildGroqUserPayload(
  query: string,
  partial: ExtractedFilters,
  unresolvedTokens: string[],
  vocab: ParserVocabulary,
): string {
  return JSON.stringify({
    query,
    partialFilters: partial,
    unresolvedTokens,
    allowed: {
      vehicleType: [...VEHICLE_TYPES],
      condition: [...CONDITIONS],
      fuelType: [...FUEL_TYPES],
      transmissionType: [...TRANSMISSION_TYPES],
      makes: vocab.makes.map((m) => m.canonical),
      models: vocab.models.map((m) => ({
        make: m.parentCanonical,
        name: m.canonical,
      })),
      specs: Object.fromEntries(
        Object.entries(KNOWN_SPEC_KEYS).map(([key, def]) => {
          if (def.type === 'enum') return [key, { type: 'enum', values: [...def.values] }];
          if (def.type === 'int') return [key, { type: 'int', min: def.min, max: def.max }];
          return [key, { type: 'bool' }];
        }),
      ),
    },
  });
}
