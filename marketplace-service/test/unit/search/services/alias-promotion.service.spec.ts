import { AliasPromotionService } from '../../../../src/modules/search/services/alias-promotion.service';

/**
 * Guards the one process in the platform that writes permanently to
 * marketplace.vehicle_dictionaries — reference data the ingestion ETL loads a
 * snapshot of on every run, and that every search facet filters against. A
 * wrong promotion is not a bad result set; it is a permanent alias nobody
 * remembers adding.
 *
 * `findBestMatch` is private, so these drive it through `promoteAliases` with
 * controlled repository returns. The trigram scores quoted in comments are
 * measured, not assumed — `trigramSimilarity` is real here, and using fitted
 * fixtures would test the fixtures rather than the thresholds.
 */

const entry = (id: string, canonicalValue: string, aliases: string[] = []) => ({
  id,
  dictionaryType: 'MAKE',
  canonicalValue,
  aliases,
});

const MAKES = [entry('mk-toyota', 'Toyota'), entry('mk-nissan', 'Nissan')];

describe('AliasPromotionService', () => {
  const repository = {
    findAliasCandidates: jest.fn(),
    findDictionaryEntries: jest.fn(),
    addAlias: jest.fn(),
  };
  const service = new AliasPromotionService(repository as never);

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findDictionaryEntries.mockResolvedValue(MAKES);
    repository.addAlias.mockResolvedValue(true);
  });

  it('promotes a clear misspelling', async () => {
    // "toyotta" vs "Toyota" = 0.800, and 0.000 against Nissan — well over the
    // threshold with the whole gap to itself.
    repository.findAliasCandidates.mockResolvedValue([
      { token: 'toyotta', occurrences: 7 },
    ]);

    const result = await service.promoteAliases();

    expect(repository.addAlias).toHaveBeenCalledWith('mk-toyota', 'toyotta');
    expect(result).toEqual({ candidates: 1, promoted: 1, skipped: 0 });
  });

  it('asks for candidates seen at least five times', async () => {
    // One person's typo is not a vocabulary gap. Pinned because lowering this
    // silently widens what the platform will write to itself.
    repository.findAliasCandidates.mockResolvedValue([]);

    await service.promoteAliases();

    expect(repository.findAliasCandidates).toHaveBeenCalledWith(5);
  });

  it('fetches the dictionary once for the whole batch', async () => {
    // An N+1 here would be one full table scan per candidate.
    repository.findAliasCandidates.mockResolvedValue([
      { token: 'toyotta', occurrences: 7 },
      { token: 'nissann', occurrences: 9 },
    ]);

    await service.promoteAliases();

    expect(repository.findDictionaryEntries).toHaveBeenCalledTimes(1);
  });

  describe('refusals', () => {
    it('refuses a token shorter than four characters', async () => {
      // Three-character trigram probes match almost anything.
      repository.findAliasCandidates.mockResolvedValue([{ token: 'toy', occurrences: 50 }]);

      const result = await service.promoteAliases();

      expect(repository.addAlias).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it('refuses a token that is already a canonical value', async () => {
      // Scores 1.000, and promoting it would add an alias identical to the
      // value it points at.
      repository.findAliasCandidates.mockResolvedValue([{ token: 'toyota', occurrences: 40 }]);

      const result = await service.promoteAliases();

      expect(repository.addAlias).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it('refuses a token that is already an alias, ignoring case and dashes', async () => {
      // normalize() folds `-`/`_` to spaces and lowercases, so "TOY-OTTA"
      // and "toy otta" are the same token.
      repository.findDictionaryEntries.mockResolvedValue([
        entry('mk-toyota', 'Toyota', ['toy otta']),
        entry('mk-nissan', 'Nissan'),
      ]);
      repository.findAliasCandidates.mockResolvedValue([
        { token: 'TOY-OTTA', occurrences: 12 },
      ]);

      const result = await service.promoteAliases();

      expect(repository.addAlias).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it('refuses a token that matches nothing well enough', async () => {
      // "zzqqxx" scores 0.000 against both makes.
      repository.findAliasCandidates.mockResolvedValue([{ token: 'zzqqxx', occurrences: 20 }]);

      const result = await service.promoteAliases();

      expect(repository.addAlias).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it('refuses a near-miss below the similarity floor', async () => {
      // "toyata" vs "Toyota" = 0.571, under MIN_SIMILARITY of 0.6. Search
      // would accept this at its own 0.45 threshold; writing an alias earns a
      // higher bar than reading one query.
      repository.findAliasCandidates.mockResolvedValue([{ token: 'toyata', occurrences: 30 }]);

      const result = await service.promoteAliases();

      expect(repository.addAlias).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it('refuses an ambiguous match rather than picking one', async () => {
      // "corolla" scores 0.750 against both "Corollx" and "Corolly" — a gap of
      // zero. Picking either would be a coin flip written permanently into the
      // dictionary.
      repository.findDictionaryEntries.mockResolvedValue([
        entry('md-x', 'Corollx'),
        entry('md-y', 'Corolly'),
      ]);
      repository.findAliasCandidates.mockResolvedValue([
        { token: 'corolla', occurrences: 25 },
      ]);

      const result = await service.promoteAliases();

      expect(repository.addAlias).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it('accepts when the winner clears the runner-up by the margin', async () => {
      // The other side of the same boundary: "corollaa" scores 0.824 against
      // Corolla and 0.706 against Corollo — a gap of 0.118, over the 0.05
      // margin. Without this the ambiguity test above would also pass if
      // somebody made the guard unconditional.
      repository.findDictionaryEntries.mockResolvedValue([
        entry('md-corolla', 'Corolla'),
        entry('md-corollo', 'Corollo'),
      ]);
      repository.findAliasCandidates.mockResolvedValue([
        { token: 'corollaa', occurrences: 25 },
      ]);

      const result = await service.promoteAliases();

      expect(repository.addAlias).toHaveBeenCalledWith('md-corolla', 'corollaa');
      expect(result.promoted).toBe(1);
    });
  });

  describe('counting', () => {
    it('counts a write the repository refused as skipped, not promoted', async () => {
      // addAlias is conditional, so a concurrent run that already added the
      // alias returns false. Counting it as promoted would overstate the job.
      repository.addAlias.mockResolvedValue(false);
      repository.findAliasCandidates.mockResolvedValue([
        { token: 'toyotta', occurrences: 7 },
      ]);

      const result = await service.promoteAliases();

      expect(result).toEqual({ candidates: 1, promoted: 0, skipped: 1 });
    });

    it('tallies a mixed batch', async () => {
      repository.findAliasCandidates.mockResolvedValue([
        { token: 'toyotta', occurrences: 7 }, // promotes
        { token: 'zzqqxx', occurrences: 9 }, // no match
        { token: 'toy', occurrences: 11 }, // too short
      ]);

      await expect(service.promoteAliases()).resolves.toEqual({
        candidates: 3,
        promoted: 1,
        skipped: 2,
      });
    });

    it('does nothing when there are no candidates', async () => {
      repository.findAliasCandidates.mockResolvedValue([]);

      await expect(service.promoteAliases()).resolves.toEqual({
        candidates: 0,
        promoted: 0,
        skipped: 0,
      });
      expect(repository.addAlias).not.toHaveBeenCalled();
    });

    it('skips everything against an empty dictionary rather than throwing', async () => {
      repository.findDictionaryEntries.mockResolvedValue([]);
      repository.findAliasCandidates.mockResolvedValue([
        { token: 'toyotta', occurrences: 7 },
      ]);

      await expect(service.promoteAliases()).resolves.toEqual({
        candidates: 1,
        promoted: 0,
        skipped: 1,
      });
    });
  });
});
