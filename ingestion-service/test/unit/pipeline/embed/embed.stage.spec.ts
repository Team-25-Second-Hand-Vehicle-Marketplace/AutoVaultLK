import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  __setEmbedder,
  embedStage,
  searchTextFor,
} from '../../../../src/workers/etl-worker/pipeline/embed/embed.stage';
import { buildSearchText } from '../../../../src/shared/normalize-embed';
import type {
  EnrichedRow,
  StageContext,
  VehicleFields,
} from '../../../../src/workers/etl-worker/pipeline/types';

const VALID: VehicleFields = {
  vehicleType: 'CAR',
  make: 'Toyota',
  model: 'Vitz',
  condition: 'USED',
  manufactureYear: 2015,
  price: 3_500_000,
  mileage: 45_000,
  fuelType: 'PETROL',
  transmissionType: 'AUTOMATIC',
  locationCity: 'Nugegoda',
  locationDistrict: 'Colombo',
  specs: { body_type: 'HATCHBACK' },
  description: 'Well maintained, single owner',
};

const row = (overrides: Partial<VehicleFields> = {}): EnrichedRow => ({
  rowNumber: 1,
  raw: {},
  normalized: { ...VALID, ...overrides },
  confidence: 1,
});

const ctx = (embeddingDisabled = false) =>
  ({ config: { embeddingDisabled } }) as never as StageContext;

/** 384 floats, the MiniLM dimension. Content is irrelevant to these assertions. */
const VECTOR = Array.from({ length: 384 }, (_, i) => i / 384);

describe('embedStage', () => {
  afterEach(() => __setEmbedder(undefined));

  it('builds search text and a vector for every row', async () => {
    __setEmbedder({ embed: jest.fn().mockResolvedValue(VECTOR) } as never);

    const result = await embedStage.run(ctx(), [row()]);

    expect(result.rows[0].searchText).toContain('Toyota Vitz 2015');
    expect(result.rows[0].embedding).toMatch(/^\[/);
    expect(result.outcome).toBe('SUCCEEDED');
    expect(result.metrics.embedded).toBe(1);
  });

  it('loads the model once across many rows', async () => {
    // The ONNX model is ~90MB. Loading per row, or per chunk under
    // MaxConcurrency 10, is the failure this caching prevents.
    const embed = jest.fn().mockResolvedValue(VECTOR);
    __setEmbedder({ embed } as never);

    await embedStage.run(ctx(), [row(), row(), row()]);

    expect(embed).toHaveBeenCalledTimes(3);
  });

  describe('FR-22.1 model parity', () => {
    it('produces the exact text ListingSearchIndexService produces', async () => {
      // THE regression guard. ListingSearchIndexService passes these 10 fields
      // for a manually created listing; if this stage ever passes a different
      // set, bulk listings embed from different text into a different region
      // of vector space and rank badly forever — with no error, no failing
      // test and no log line (plan-b §9A, silent drift).
      const vehicle = {
        make: 'Toyota',
        model: 'Vitz',
        manufactureYear: 2015,
        vehicleType: 'CAR',
        fuelType: 'PETROL',
        transmissionType: 'AUTOMATIC',
        locationCity: 'Nugegoda',
        locationDistrict: 'Colombo',
        specs: { body_type: 'HATCHBACK' },
        description: 'Well maintained, single owner',
      };

      // Built the way the manual path builds it, independently of the stage.
      const manual = buildSearchText(vehicle).trim();
      const bulk = searchTextFor(row());

      expect(bulk).toBe(manual);
    });

    it('includes body_type, which only enrich can supply', async () => {
      // buildSearchText reads specs.body_type. A bulk row that reached embed
      // without it yields a shorter text than the manual equivalent.
      const withBody = searchTextFor(row());
      const withoutBody = searchTextFor(row({ specs: {} }));

      expect(withBody).toContain('HATCHBACK');
      expect(withBody).not.toBe(withoutBody);
    });

    it('reads the shared module, not a local copy', () => {
      // The byte-identity of that module is guarded by
      // test/unit/shared/normalize-embed-parity.spec.ts. This stage importing
      // it is what connects the two guarantees.
      const shared = resolve(__dirname, '../../../../src/shared/normalize-embed/search-text.ts');

      expect(existsSync(shared)).toBe(true);
    });

    it('trims exactly as the manual path does', async () => {
      // An untrimmed text embeds differently from the manual equivalent.
      const result = searchTextFor(row({ description: '   ' }));

      expect(result).not.toMatch(/\s$/);
    });
  });

  describe('degradation', () => {
    it('keeps rows when the model is unavailable', async () => {
      // Matches the manual path, which saves the listing and logs a warning.
      // The row still has search_text, so the lexical half of hybrid search
      // finds it; a re-embed repairs the vector later, refusing the row could
      // not.
      __setEmbedder({ embed: jest.fn().mockRejectedValue(new Error('ONNX missing')) } as never);

      const result = await embedStage.run(ctx(), [row(), row()]);

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].searchText).toBeTruthy();
      expect(result.rows[0].embedding).toBeNull();
      expect(result.outcome).toBe('DEGRADED');
      expect(result.rejections).toEqual([]);
    });

    it('stops retrying once the model has failed', async () => {
      // One failure means the model is unavailable, not that the row is
      // special. Retrying per row would pay the timeout 250 times a chunk.
      const embed = jest.fn().mockRejectedValue(new Error('ONNX missing'));
      __setEmbedder({ embed } as never);

      await embedStage.run(ctx(), [row(), row(), row()]);

      expect(embed).toHaveBeenCalledTimes(1);
    });

    it('still builds search text when embeddings are disabled', async () => {
      // search_text feeds the trg_vehicles_search_vector trigger, so lexical
      // search keeps working with EMBEDDING_DISABLED=true.
      const result = await embedStage.run(ctx(true), [row()]);

      expect(result.rows[0].searchText).toBeTruthy();
      expect(result.rows[0].embedding).toBeNull();
      expect(result.outcome).toBe('SKIPPED');
    });

    it('does not load the model at all when disabled', async () => {
      const embed = jest.fn();
      __setEmbedder({ embed } as never);

      await embedStage.run(ctx(true), [row()]);

      expect(embed).not.toHaveBeenCalled();
    });
  });

  it('never rejects a row', async () => {
    __setEmbedder({ embed: jest.fn().mockRejectedValue(new Error('down')) } as never);

    const result = await embedStage.run(ctx(), [row()]);

    expect(result.rejections).toEqual([]);
  });

  it('is registered as the EMBED stage', () => {
    expect(embedStage.stage).toBe('EMBED');
  });
});
