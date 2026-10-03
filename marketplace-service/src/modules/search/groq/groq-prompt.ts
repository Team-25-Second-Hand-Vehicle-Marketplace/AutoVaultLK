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

Allowed keys inside "filters", and nothing else:
make, model, vehicleType, condition, fuelType, transmissionType,
minPrice, maxPrice, minYear, maxYear, minMileage, maxMileage, specs

Your main job is fixing misspellings the deterministic parser could not
match. Sri Lankan buyers routinely mistype brand names ("mistubisi",
"toyata", "nisan"). For each unresolved token, if it is plausibly a
phonetic or keyboard-slip variant of exactly one entry in the allowed
lists, map it to that entry. Only leave it out when two or more entries
are equally plausible, or none is.

Rules:
- Read the whole query the way a person would and work out what kind of
  vehicle the buyer wants. Keep fields the parser already set; fill the rest.
- Never invent a value that is absent from the allowed lists - but
  correcting a misspelled token TO an allowed value is required, not
  inventing.
- A vehicle-character or style word - e.g. "sport"/"sporty", "luxury",
  "economical", "fast", "spacious", "reliable", "affordable",
  "comfortable" - describes how a listing feels, never a specific make or
  model, even when it happens to look similar to one (e.g. "sport" is never
  a misspelling of "Sportage"). Put them in consumedTokens only when they set vehicleType, and never use
  them to justify a make/model/bodyType correction - leave them unresolved
  so semantic ranking can match them against listings' own descriptions
  instead of hard-locking the search to one guessed vehicle.
- Every filter key is SINGULAR even though its value is an array and the
  allowed lists are named in the plural: write "make":["Toyota"], never
  "makes". A plural key is discarded.
- make/model values must be copied exactly from allowed.makes / allowed.models.
- vehicleType/condition/fuelType/transmissionType must be copied exactly from the allowed enums.
- specs.key must be one of the allowed spec keys; enum specs.value must be an allowed value.
- Numeric fields are integers. Years 1980-2100. Prices in LKR. Mileage in km.
- "family friendly", "family car" or "family vehicle" means a family-sized
  vehicle: when these words are unresolved, set vehicleType to ["VAN","SUV"]
  and list "family" and "friendly" in consumedTokens. Never use them to pick
  a make or model.
- Think about who the vehicle is for, the way a person would. One person
  or a single rider means BIKE or THREE_WHEELER. A family or several
  passengers means VAN or SUV. Goods, work or farming means PICKUP, VAN,
  LORRY, TRUCK or TRACTOR. Set vehicleType from that, and list the words
  you relied on in consumedTokens if they were unresolved.
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
          if (def.type === 'enum')
            return [key, { type: 'enum', values: [...def.values] }];
          if (def.type === 'int')
            return [key, { type: 'int', min: def.min, max: def.max }];
          return [key, { type: 'bool' }];
        }),
      ),
    },
  });
}
