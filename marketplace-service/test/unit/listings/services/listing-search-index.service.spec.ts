import { Logger } from '@nestjs/common';
import { ListingSearchIndexService } from '../../../../src/modules/listings/services/listing-search-index.service';
import { buildSearchText, createXenovaEmbedder } from '../../../../src/shared/normalize-embed';
import type { Vehicle } from '../../../../src/infrastructure/database/entities/vehicle.entity';

/**
 * The FR-22.1 parity point on the manual-listing side: whatever this produces
 * is what a bulk-uploaded row must produce too, or the two land in different
 * regions of the same vector space and rank against each other badly — with no
 * error and no failing test anywhere.
 *
 * Only `createXenovaEmbedder` is mocked. `buildSearchText` and `toPgVector`
 * stay real: faking them would test the mock rather than the thing the parity
 * guarantee rests on.
 */
jest.mock('../../../../src/shared/normalize-embed', () => ({
  ...jest.requireActual('../../../../src/shared/normalize-embed'),
  createXenovaEmbedder: jest.fn(),
}));

const VEHICLE = {
  make: 'Toyota',
  model: 'Vitz',
  manufactureYear: 2015,
  vehicleType: 'CAR',
  condition: 'USED',
  fuelType: 'PETROL',
  transmissionType: 'AUTOMATIC',
  price: 3_500_000,
  mileage: 45_000,
  locationCity: 'Nugegoda',
  locationDistrict: 'Colombo',
  specs: { body_type: 'HATCHBACK' },
  description: 'Well maintained',
  // Only the indexable fields; a full Vehicle also carries ids, timestamps and
  // relations that build() never reads.
} as unknown as Vehicle;

/** 384 floats — the MiniLM dimension. Values are irrelevant here. */
const VECTOR = Array.from({ length: 384 }, () => 0.1);

const mockedCreate = createXenovaEmbedder as jest.MockedFunction<
  typeof createXenovaEmbedder
>;

describe('ListingSearchIndexService', () => {
  let embed: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    embed = jest.fn().mockResolvedValue(VECTOR);
    mockedCreate.mockReturnValue({ embed } as never);
  });

  it('builds search text and a pgvector literal', async () => {
    const result = await new ListingSearchIndexService().build(VEHICLE);

    expect(result.searchText).toContain('Toyota Vitz 2015');
    expect(result.embedding).toMatch(/^\[/);
  });

  it('produces exactly what buildSearchText produces for the same fields', async () => {
    // The parity assertion. If this service ever passes a different field set,
    // the text diverges from the bulk path's — which is the failure mode that
    // has no other symptom.
    const result = await new ListingSearchIndexService().build(VEHICLE);

    expect(result.searchText).toBe(buildSearchText(VEHICLE as never).trim());
  });

  it('embeds the trimmed text, which is also what gets stored', async () => {
    // Storing one string and embedding another would put the row in a
    // different place from where its own search text says it should be.
    const result = await new ListingSearchIndexService().build(VEHICLE);

    expect(embed).toHaveBeenCalledWith(result.searchText);
  });

  it('returns nulls rather than embedding an empty string', async () => {
    // Every indexable field blank. Not reachable from the database — make,
    // model and manufacture_year are NOT NULL — but the guard exists so a
    // partially-built entity never gets a vector computed from nothing.
    //
    // Note buildSearchText does `String(manufactureYear)` unconditionally, so
    // an entity missing that field yields the literal "undefined" rather than
    // an empty string. Hence a blank-but-present year here.
    const blank = {
      make: '',
      model: '',
      manufactureYear: '',
      vehicleType: '',
      condition: '',
      fuelType: null,
      transmissionType: null,
      price: '',
      mileage: '',
      locationCity: null,
      locationDistrict: null,
      specs: {},
      description: null,
    } as unknown as Vehicle;

    await expect(new ListingSearchIndexService().build(blank)).resolves.toEqual({
      searchText: null,
      embedding: null,
    });
    expect(embed).not.toHaveBeenCalled();
  });

  describe('caching', () => {
    it('loads the model once across many listings', async () => {
      // The ONNX model is ~90MB. Loading it per listing would make a bulk
      // review session unusable.
      const service = new ListingSearchIndexService();

      await service.build(VEHICLE);
      await service.build(VEHICLE);
      await service.build(VEHICLE);

      expect(mockedCreate).toHaveBeenCalledTimes(1);
      expect(embed).toHaveBeenCalledTimes(3);
    });

    it('caches per instance, not globally', async () => {
      // Nest holds this as a singleton, so per-instance is equivalent in
      // production — but pinning the actual semantics stops a later reader
      // assuming module-level state that is not there.
      await new ListingSearchIndexService().build(VEHICLE);
      await new ListingSearchIndexService().build(VEHICLE);

      expect(mockedCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('EMBEDDING_DISABLED', () => {
    afterEach(() => {
      delete process.env.EMBEDDING_DISABLED;
    });

    it('keeps the search text but never touches the model', async () => {
      process.env.EMBEDDING_DISABLED = 'true';

      const result = await new ListingSearchIndexService().build(VEHICLE);

      expect(result.searchText).toContain('Toyota Vitz 2015');
      expect(result.embedding).toBeNull();
      expect(embed).not.toHaveBeenCalled();
    });
  });

  describe('degradation', () => {
    it('saves the listing without a vector when MiniLM is down', async () => {
      // Refusing the listing would be worse: the row still has search_text, so
      // the lexical half of hybrid search finds it, and a re-embed repairs the
      // vector later.
      embed.mockRejectedValue(new Error('ONNX runtime missing'));

      await expect(new ListingSearchIndexService().build(VEHICLE)).resolves.toMatchObject({
        embedding: null,
      });
    });

    it('keeps the search text when the embedder fails', async () => {
      embed.mockRejectedValue(new Error('ONNX runtime missing'));

      const result = await new ListingSearchIndexService().build(VEHICLE);

      expect(result.searchText).toContain('Toyota Vitz 2015');
    });

    it('warns with the reason', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      embed.mockRejectedValue(new Error('ONNX runtime missing'));

      await new ListingSearchIndexService().build(VEHICLE);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ONNX runtime missing'));
      warn.mockRestore();
    });

    it('survives a thrown non-Error', async () => {
      // A rejected string has no `.message`; reading it blindly would turn a
      // degraded embed into a crashed save.
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      embed.mockRejectedValue('just a string');

      await expect(new ListingSearchIndexService().build(VEHICLE)).resolves.toMatchObject({
        embedding: null,
      });
      warn.mockRestore();
    });
  });
});
