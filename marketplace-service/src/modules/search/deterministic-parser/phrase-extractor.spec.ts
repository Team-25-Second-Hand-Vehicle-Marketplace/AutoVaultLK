import { extractPhrases, DOMAIN_PHRASES } from './phrase-extractor';
import { tokenize } from './tokenizer';
import { ParsedFilters } from './parser.types';
import { buildCache, DictionaryCache } from '../repositories/vehicle-dictionary.repository';
import { KNOWN_SPEC_KEYS } from '../constants/known-spec-keys.constants';
import {
  VEHICLE_TYPES,
  CONDITIONS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
} from '../constants/vehicle-attributes.constants';

/**
 * Fixture rows shaped exactly like the real seed, including the multi-word
 * canonical values and multi-word aliases that motivated this stage.
 */
const ROWS = [
  {
    id: 'make-toyota',
    parent_id: null,
    dictionary_type: 'MAKE',
    canonical_value: 'Toyota',
    vehicle_types: ['CAR', 'SUV', 'VAN'],
    aliases: ['toyata', 'toyta'],
  },
  {
    id: 'make-ashok',
    parent_id: null,
    dictionary_type: 'MAKE',
    canonical_value: 'Ashok Leyland',
    vehicle_types: ['LORRY', 'BUS'],
    aliases: ['ashok leylend'],
  },
  {
    id: 'make-land-rover',
    parent_id: null,
    dictionary_type: 'MAKE',
    canonical_value: 'Land Rover',
    vehicle_types: ['SUV'],
    aliases: [],
  },
  {
    id: 'model-land-cruiser',
    parent_id: 'make-toyota',
    dictionary_type: 'MODEL',
    canonical_value: 'Land Cruiser',
    vehicle_types: ['SUV'],
    aliases: ['landcruiser', 'land cruser'],
  },
  {
    id: 'model-prado',
    parent_id: 'make-toyota',
    dictionary_type: 'MODEL',
    canonical_value: 'Prado',
    vehicle_types: ['SUV'],
    aliases: [],
  },
  {
    id: 'model-rav4',
    parent_id: 'make-toyota',
    dictionary_type: 'MODEL',
    canonical_value: 'RAV4',
    vehicle_types: ['SUV'],
    aliases: ['rav 4'],
  },
  {
    id: 'model-townace',
    parent_id: 'make-toyota',
    dictionary_type: 'MODEL',
    canonical_value: 'Townace',
    vehicle_types: ['VAN'],
    aliases: ['town ace'],
  },
  {
    id: 'model-rr-evoque',
    parent_id: 'make-land-rover',
    dictionary_type: 'MODEL',
    canonical_value: 'Range Rover Evoque',
    vehicle_types: ['SUV'],
    aliases: [],
  },
  {
    id: 'body-sedan',
    parent_id: null,
    dictionary_type: 'BODY_TYPE',
    canonical_value: 'Sedan',
    vehicle_types: [],
    aliases: [],
  },
];

let dict: DictionaryCache;

beforeEach(() => {
  dict = buildCache(ROWS);
});

/** Runs stage 0 then stage 1, returning both halves of the result. */
function run(query: string) {
  const tokens = tokenize(query);
  const filters: ParsedFilters = {};
  extractPhrases(tokens, dict, filters);
  return { tokens, filters };
}

/** Tokens still available to later stages. */
const remaining = (tokens: ReturnType<typeof run>['tokens']) =>
  tokens.filter((t) => t.role === 'unconsumed').map((t) => t.text);

describe('buildCache — phrase indexing', () => {
  it('routes multi-word canonical values into the phrase index', () => {
    expect(dict.modelPhrases.has('land cruiser')).toBe(true);
    expect(dict.makePhrases.has('ashok leyland')).toBe(true);
  });

  it('routes multi-word aliases into the phrase index', () => {
    expect(dict.modelPhrases.has('land cruser')).toBe(true);
    expect(dict.modelPhrases.has('rav 4')).toBe(true);
    expect(dict.makePhrases.has('ashok leylend')).toBe(true);
  });

  it('keeps single-word aliases in the exact index, not the phrase index', () => {
    expect(dict.modelExact.has('landcruiser')).toBe(true);
    expect(dict.modelPhrases.has('landcruiser')).toBe(false);
  });

  it('indexes single-word canonical values as exact entries', () => {
    expect(dict.makeExact.get('toyota')?.canonicalValue).toBe('Toyota');
    expect(dict.modelExact.get('prado')?.canonicalValue).toBe('Prado');
  });

  it('skips closed-enum dictionary types', () => {
    // BODY_TYPE lives in KNOWN_SPEC_KEYS, not the dictionary vocabulary.
    expect(dict.makeExact.has('sedan')).toBe(false);
    expect(dict.modelExact.has('sedan')).toBe(false);
  });

  it('builds the make -> models index', () => {
    const models = dict.modelsByMakeId.get('make-toyota') ?? [];
    expect(models.map((m) => m.canonicalValue).sort()).toEqual([
      'Land Cruiser',
      'Prado',
      'RAV4',
      'Townace',
    ]);
  });
});

describe('extractPhrases — dictionary phrases', () => {
  it('claims a multi-word model as one unit', () => {
    const { tokens, filters } = run('land cruiser');
    expect(filters.model).toEqual(['Land Cruiser']);
    expect(tokens.every((t) => t.role === 'phrase')).toBe(true);
    expect(remaining(tokens)).toEqual([]);
  });

  it('resolves a multi-word alias to the canonical value', () => {
    const { filters } = run('land cruser');
    expect(filters.model).toEqual(['Land Cruiser']);
  });

  it('claims a multi-word make', () => {
    const { filters } = run('ashok leyland');
    expect(filters.make).toEqual(['Ashok Leyland']);
  });

  it('resolves an alias with a number in it', () => {
    const { filters } = run('rav 4');
    expect(filters.model).toEqual(['RAV4']);
  });

  it('leaves surrounding tokens for later stages', () => {
    const { tokens, filters } = run('toyota land cruiser 2015');
    expect(filters.model).toEqual(['Land Cruiser']);
    // "toyota" is a single-token make — Stage 3's job, not this stage's.
    expect(remaining(tokens)).toEqual(['toyota', '2015']);
  });
});

describe('extractPhrases — longest match wins', () => {
  it('prefers the longer phrase when both could match', () => {
    // "Range Rover Evoque" (3 words) must beat any 2-word prefix.
    const { tokens, filters } = run('range rover evoque');
    expect(filters.model).toEqual(['Range Rover Evoque']);
    expect(remaining(tokens)).toEqual([]);
  });

  it('does not let a shorter phrase orphan a following token', () => {
    const { filters } = run('toyota land cruiser prado');
    // Land Cruiser claimed as a unit; Prado stays available as a single token.
    expect(filters.model).toEqual(['Land Cruiser']);
  });

  it('matches "land rover" as a make rather than fragmenting it', () => {
    const { filters } = run('land rover');
    expect(filters.make).toEqual(['Land Rover']);
  });
});

describe('extractPhrases — adjacency is strict', () => {
  it('does not bridge a phrase across a masked stopword', () => {
    // "land the cruiser" is not a Land Cruiser. Allowing filler to bridge
    // words would manufacture compounds that were never typed.
    const { tokens, filters } = run('land the cruiser');
    expect(filters.model).toBeUndefined();
    expect(remaining(tokens)).toEqual(['land', 'cruiser']);
  });

  it('does not match a phrase split across unrelated words', () => {
    const { filters } = run('land blue cruiser');
    expect(filters.model).toBeUndefined();
  });

  it('matches a phrase at the end of a query', () => {
    const { filters } = run('i want a land cruiser');
    expect(filters.model).toEqual(['Land Cruiser']);
  });

  it('matches a phrase at the start of a query', () => {
    const { filters } = run('land cruiser for sale');
    expect(filters.model).toEqual(['Land Cruiser']);
  });
});

describe('extractPhrases — domain compounds', () => {
  it('maps "three wheeler" to the vehicle type', () => {
    const { filters } = run('three wheeler');
    expect(filters.vehicleType).toEqual(['THREE_WHEELER']);
  });

  it('maps "brand new" to the condition', () => {
    const { filters } = run('brand new toyota');
    expect(filters.condition).toEqual(['NEW']);
  });

  it('maps "second hand" to USED', () => {
    const { filters } = run('second hand car');
    expect(filters.condition).toEqual(['USED']);
  });

  it('maps "semi automatic" to the transmission', () => {
    const { filters } = run('semi automatic');
    expect(filters.transmissionType).toEqual(['SEMI_AUTOMATIC']);
  });

  it('maps "four wheel drive" to a drive_type spec', () => {
    const { filters } = run('four wheel drive');
    expect(filters.specs).toEqual([{ key: 'drive_type', value: '4WD' }]);
  });

  it('prefers "four wheel drive" over the shorter "four wheel"', () => {
    const { tokens } = run('four wheel drive');
    expect(remaining(tokens)).toEqual([]);
  });

  it('maps "station wagon" to a body_type spec', () => {
    const { filters } = run('station wagon');
    expect(filters.specs).toEqual([{ key: 'body_type', value: 'WAGON' }]);
  });

  it('maps "plugin hybrid" to HYBRID fuel', () => {
    const { filters } = run('plugin hybrid');
    expect(filters.fuelType).toEqual(['HYBRID']);
  });

  it('does not match "plug in hybrid", whose middle word is masked', () => {
    // Documents the consequence of the two rules meeting: the spaced spelling
    // is unmatchable by design. A buyer typing it falls through to
    // semanticText, where the embedding handles it — an acceptable outcome,
    // and strictly better than letting filler bridge arbitrary words.
    const { filters } = run('plug in hybrid');
    expect(filters.fuelType).toBeUndefined();
  });
});

describe('extractPhrases — deduplication', () => {
  it('does not add the same value twice', () => {
    const { filters } = run('brand new and brand new');
    expect(filters.condition).toEqual(['NEW']);
  });

  it('does not add the same spec twice', () => {
    const { filters } = run('four wheel drive all wheel drive');
    expect(filters.specs).toEqual([
      { key: 'drive_type', value: '4WD' },
      { key: 'drive_type', value: 'AWD' },
    ]);
  });
});

describe('extractPhrases — no-op cases', () => {
  it('does nothing on a query with no phrases', () => {
    const { tokens, filters } = run('toyota aqua 2015');
    expect(filters).toEqual({});
    expect(remaining(tokens)).toEqual(['toyota', 'aqua', '2015']);
  });

  it('does nothing on an empty token array', () => {
    const filters: ParsedFilters = {};
    expect(() => extractPhrases([], dict, filters)).not.toThrow();
    expect(filters).toEqual({});
  });

  it('does nothing when the dictionary is empty', () => {
    const empty = buildCache([]);
    const tokens = tokenize('land cruiser');
    const filters: ParsedFilters = {};
    extractPhrases(tokens, empty, filters);
    // Domain phrases are hardcoded, so an empty dictionary still leaves the
    // dictionary-derived half inert without throwing.
    expect(filters.model).toBeUndefined();
  });
});

describe('DOMAIN_PHRASES integrity', () => {
  it('only contains multi-word keys', () => {
    for (const phrase of Object.keys(DOMAIN_PHRASES)) {
      expect(phrase.split(' ').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('only emits values that exist in the constants', () => {
    const valid: Record<string, readonly string[]> = {
      vehicleType: VEHICLE_TYPES,
      condition: CONDITIONS,
      fuelType: FUEL_TYPES,
      transmissionType: TRANSMISSION_TYPES,
    };

    for (const target of Object.values(DOMAIN_PHRASES)) {
      if (target.field === 'spec') {
        const definition = KNOWN_SPEC_KEYS[target.specKey as keyof typeof KNOWN_SPEC_KEYS];
        expect(definition).toBeDefined();
        expect(definition.type).toBe('enum');
        expect((definition as { values: readonly string[] }).values).toContain(target.value);
      } else {
        expect(valid[target.field]).toContain(target.value);
      }
    }
  });

  it('is lowercase throughout, matching tokenizer output', () => {
    for (const phrase of Object.keys(DOMAIN_PHRASES)) {
      expect(phrase).toBe(phrase.toLowerCase());
    }
  });

  it('contains no key the tokenizer would split differently', () => {
    // A phrase key must survive tokenization unchanged, or it can never match.
    for (const phrase of Object.keys(DOMAIN_PHRASES)) {
      expect(tokenize(phrase).map((t) => t.text)).toEqual(phrase.split(' '));
    }
  });

  it('contains no key whose own words the tokenizer masks', () => {
    // This is the check that caught "plug in hybrid": "in" is a generic
    // stopword, so the phrase tokenizes with a masked middle token, and
    // matchesAt() requires every token in the run to be unconsumed. Such a
    // key is unmatchable dead weight — it looks like a supported synonym in
    // the source but can never fire.
    //
    // Both underlying rules are correct (masking "in" is right; refusing to
    // bridge masked tokens is right), so the fix is always to reword the
    // phrase, never to weaken either rule.
    for (const phrase of Object.keys(DOMAIN_PHRASES)) {
      const masked = tokenize(phrase)
        .filter((t) => t.role === 'stopword')
        .map((t) => t.text);
      expect({ phrase, masked }).toEqual({ phrase, masked: [] });
    }
  });
});
