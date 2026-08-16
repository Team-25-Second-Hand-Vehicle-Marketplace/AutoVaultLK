<<<<<<< HEAD
import { Logger } from '@nestjs/common';
import { VehicleDictionaryRepository, buildCache } from './vehicle-dictionary.repository';

/**
 * The dictionary cache is load-bearing for the whole parser: every stage from
 * phrase extraction onward matches against it, and it is the reason fuzzy
 * matching can run in process instead of costing a database round-trip per
 * token.
 *
 * Two things are worth testing independently. buildCache() is a pure function
 * over rows — indexing, alias handling, phrase routing. The repository around
 * it owns caching policy: TTL, concurrent-load de-duplication, and what
 * happens when the database is unreachable.
 */

const ROWS = [
  {
    id: 'mk-toyota',
    parent_id: null,
    dictionary_type: 'MAKE',
    canonical_value: 'Toyota',
    vehicle_types: ['CAR', 'SUV', 'VAN'],
    aliases: ['toyata', 'toyta'],
  },
  {
    id: 'mk-ashok',
    parent_id: null,
    dictionary_type: 'MAKE',
    canonical_value: 'Ashok Leyland',
    vehicle_types: ['LORRY'],
    aliases: ['ashok leylend'],
  },
  {
    id: 'md-lc',
    parent_id: 'mk-toyota',
    dictionary_type: 'MODEL',
    canonical_value: 'Land Cruiser',
    vehicle_types: ['SUV'],
    aliases: ['landcruiser', 'land cruser'],
  },
  {
    id: 'md-aqua',
    parent_id: 'mk-toyota',
    dictionary_type: 'MODEL',
    canonical_value: 'Aqua',
    vehicle_types: ['CAR'],
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

function makeRepository(rows: unknown[] = ROWS) {
  const query = jest.fn().mockResolvedValue(rows);
  const repository = new VehicleDictionaryRepository({ query } as never);
  return { repository, query };
}

describe('buildCache — exact indexing', () => {
  it('indexes canonical values lowercased', () => {
    const cache = buildCache(ROWS);

    expect(cache.makeExact.get('toyota')?.canonicalValue).toBe('Toyota');
    expect(cache.modelExact.get('aqua')?.canonicalValue).toBe('Aqua');
  });

  it('indexes single-word aliases as exact hits', () => {
    const cache = buildCache(ROWS);

    // A known misspelling is a *known* value — resolving "toyata" must cost
    // the same as resolving "toyota". That zero-cost resolution is the whole
    // payoff of the alias-promotion loop.
    expect(cache.makeExact.get('toyata')?.canonicalValue).toBe('Toyota');
    expect(cache.modelExact.get('landcruiser')?.canonicalValue).toBe('Land Cruiser');
  });

  it('keeps makes and models in separate indexes', () => {
    const cache = buildCache(ROWS);

    expect(cache.makeExact.has('aqua')).toBe(false);
    expect(cache.modelExact.has('toyota')).toBe(false);
  });

  it('skips closed-enum dictionary types', () => {
    const cache = buildCache(ROWS);

    // BODY_TYPE belongs to KNOWN_SPEC_KEYS, not the dictionary vocabulary.
    expect(cache.makeExact.has('sedan')).toBe(false);
    expect(cache.modelExact.has('sedan')).toBe(false);
    expect(cache.allMakes.map((m) => m.canonicalValue)).not.toContain('Sedan');
  });
});

describe('buildCache — phrase routing', () => {
  it('routes multi-word canonical values to the phrase index', () => {
    const cache = buildCache(ROWS);

    expect(cache.makePhrases.get('ashok leyland')?.canonicalValue).toBe('Ashok Leyland');
    expect(cache.modelPhrases.get('land cruiser')?.canonicalValue).toBe('Land Cruiser');
  });

  it('routes multi-word aliases to the phrase index', () => {
    const cache = buildCache(ROWS);

    expect(cache.modelPhrases.get('land cruser')?.canonicalValue).toBe('Land Cruiser');
  });

  it('keeps multi-word values out of the exact index', () => {
    const cache = buildCache(ROWS);

    // The tokenizer splits on whitespace, so a multi-word key could never
    // match a single token anyway — indexing it there would be dead weight.
    expect(cache.makeExact.has('ashok leyland')).toBe(false);
  });

  it('lets one entry appear in both indexes under different forms', () => {
    const cache = buildCache(ROWS);

    // "Land Cruiser" is a phrase; its alias "landcruiser" is a single token.
    expect(cache.modelPhrases.get('land cruiser')?.id).toBe('md-lc');
    expect(cache.modelExact.get('landcruiser')?.id).toBe('md-lc');
  });
});

describe('buildCache — relational structure', () => {
  it('groups models under their parent make', () => {
    const cache = buildCache(ROWS);

    const models = cache.modelsByMakeId.get('mk-toyota') ?? [];
    expect(models.map((m) => m.canonicalValue).sort()).toEqual(['Aqua', 'Land Cruiser']);
  });

  it('indexes makes by id for the make-scoped model lookup', () => {
    const cache = buildCache(ROWS);

    expect(cache.makesById.get('mk-toyota')?.canonicalValue).toBe('Toyota');
  });

  it('carries vehicle types through for type-scoped matching', () => {
    const cache = buildCache(ROWS);

    expect(cache.makeExact.get('toyota')?.vehicleTypes).toEqual(['CAR', 'SUV', 'VAN']);
  });

  it('builds flat lists for the trigram scan', () => {
    const cache = buildCache(ROWS);

    expect(cache.allMakes).toHaveLength(2);
    expect(cache.allModels).toHaveLength(2);
  });
});

describe('buildCache — defensive handling', () => {
  it('handles an empty row set', () => {
    const cache = buildCache([]);

    expect(cache.allMakes).toEqual([]);
    expect(cache.makeExact.size).toBe(0);
  });

  it('tolerates null aliases and vehicle_types', () => {
    const cache = buildCache([
      {
        id: 'mk-x',
        parent_id: null,
        dictionary_type: 'MAKE',
        canonical_value: 'Kia',
        vehicle_types: null,
        aliases: null,
      },
    ]);

    expect(cache.makeExact.get('kia')?.aliases).toEqual([]);
    expect(cache.makeExact.get('kia')?.vehicleTypes).toEqual([]);
  });

  it('preserves hyphens, which the tokenizer also preserves', () => {
    const cache = buildCache([
      {
        id: 'mk-mb',
        parent_id: null,
        dictionary_type: 'MAKE',
        canonical_value: 'Mercedes-Benz',
        vehicle_types: ['CAR'],
        aliases: ['benz'],
      },
    ]);

    // The tokenizer keeps hyphens between letters, so "Mercedes-Benz" arrives
    // as one hyphenated token and must match a hyphenated key.
    expect(cache.makeExact.has('mercedes-benz')).toBe(true);
    expect(cache.makeExact.get('benz')?.canonicalValue).toBe('Mercedes-Benz');
  });

  it('keeps the first entry on a duplicate key', () => {
    const cache = buildCache([
      { id: 'a', parent_id: null, dictionary_type: 'MAKE', canonical_value: 'Toyota', vehicle_types: [], aliases: [] },
      { id: 'b', parent_id: null, dictionary_type: 'MAKE', canonical_value: 'Toyota', vehicle_types: [], aliases: [] },
    ]);

    // Duplicates are a seed bug (migration 22000's partial unique index
    // exists to prevent them). Preferring the later row would make resolution
    // depend on unordered query results.
    expect(cache.makeExact.get('toyota')?.id).toBe('a');
  });
});

describe('VehicleDictionaryRepository — caching policy', () => {
  it('queries the database on the first call', async () => {
    const { repository, query } = makeRepository();

    await repository.getCache();

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('serves subsequent calls from cache', async () => {
    const { repository, query } = makeRepository();

    await repository.getCache();
    await repository.getCache();
    await repository.getCache();

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns the same cache instance so phrase candidates stay memoized', async () => {
    const { repository } = makeRepository();

    const first = await repository.getCache();
    const second = await repository.getCache();

    // The phrase extractor keys its candidate list on cache identity via a
    // WeakMap; a new object every call would rebuild that list per query.
    expect(second).toBe(first);
  });

  it('de-duplicates concurrent cold-cache loads', async () => {
    const { repository, query } = makeRepository();

    await Promise.all([
      repository.getCache(),
      repository.getCache(),
      repository.getCache(),
    ]);

    // Without in-flight tracking, N requests arriving on a cold cache each
    // fire their own dictionary query.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reloads after invalidate()', async () => {
    const { repository, query } = makeRepository();

    await repository.getCache();
    repository.invalidate();
    await repository.getCache();

    expect(query).toHaveBeenCalledTimes(2);
  });

  it('only loads active rows', async () => {
    const { repository, query } = makeRepository();

    await repository.getCache();

    expect(query.mock.calls[0][0]).toContain('is_active = true');
  });
});

describe('VehicleDictionaryRepository — failure resilience', () => {
  // These cases deliberately drive the error path. Silence the Nest logger so
  // the expected errors do not read as real failures in test output.
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('returns an empty cache rather than throwing on a cold-cache failure', async () => {
    const query = jest.fn().mockRejectedValue(new Error('connection refused'));
    const repository = new VehicleDictionaryRepository({ query } as never);

    // A dictionary outage must degrade search to "resolve nothing", not
    // fail the request.
    const cache = await repository.getCache();

    expect(cache.allMakes).toEqual([]);
  });

  it('serves the stale cache when a reload fails', async () => {
    const query = jest.fn().mockResolvedValueOnce(ROWS);
    const repository = new VehicleDictionaryRepository({ query } as never);

    const fresh = await repository.getCache();
    expect(fresh.allMakes).toHaveLength(2);

    repository.invalidate();
    query.mockRejectedValueOnce(new Error('connection refused'));

    const stale = await repository.getCache();

    // Stale vocabulary is strictly better than none.
    expect(stale.allMakes).toHaveLength(2);
  });

  it('clears the in-flight promise after a failure so the next call retries', async () => {
    const query = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(ROWS);
    const repository = new VehicleDictionaryRepository({ query } as never);

    const first = await repository.getCache();
    expect(first.allMakes).toEqual([]);

    const second = await repository.getCache();
    expect(second.allMakes).toHaveLength(2);
=======
import { rowsToVocabulary } from './vehicle-dictionary.repository';

describe('rowsToVocabulary', () => {
  it('nests models under their parent make canonical', () => {
    const vocab = rowsToVocabulary([
      {
        dictionary_type: 'MAKE',
        canonical_value: 'Toyota',
        aliases: ['toyata'],
        vehicle_types: ['CAR', 'SUV'],
        parent_canonical: null,
      },
      {
        dictionary_type: 'MODEL',
        canonical_value: 'Corolla',
        aliases: '["corrola"]',
        vehicle_types: ['CAR'],
        parent_canonical: 'Toyota',
      },
      {
        dictionary_type: 'BODY_TYPE',
        canonical_value: 'SEDAN',
        aliases: ['saloon'],
        vehicle_types: [],
        parent_canonical: null,
      },
    ]);

    expect(vocab.makes).toEqual([
      {
        canonical: 'Toyota',
        aliases: ['toyata'],
        vehicleTypes: ['CAR', 'SUV'],
        parentCanonical: undefined,
      },
    ]);
    expect(vocab.models[0]).toMatchObject({
      canonical: 'Corolla',
      aliases: ['corrola'],
      parentCanonical: 'Toyota',
    });
    expect(vocab.bodyTypes[0].canonical).toBe('SEDAN');
>>>>>>> origin/feat/IntelligentSparser2nd
  });
});
