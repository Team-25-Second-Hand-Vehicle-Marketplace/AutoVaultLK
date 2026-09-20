import { AliasPromotionRepository } from '../../../../src/modules/search/repositories/alias-promotion.repository';

/** The SQL of the call at `index`, for asserting load-bearing clauses. */
const sqlOf = (query: jest.Mock, index = 0): string =>
  String(query.mock.calls[index][0]);

describe('AliasPromotionRepository', () => {
  const dataSource = { query: jest.fn() };
  const repository = new AliasPromotionRepository(dataSource as never);

  beforeEach(() => jest.clearAllMocks());

  describe('findAliasCandidates', () => {
    it('forwards the occurrence floor as a parameter', async () => {
      dataSource.query.mockResolvedValue([]);

      await repository.findAliasCandidates(5);

      expect(dataSource.query.mock.calls[0][1]).toEqual([5]);
      expect(sqlOf(dataSource.query)).toContain('HAVING COUNT(*) >= $1');
    });

    it('excludes tokens too short to match reliably', async () => {
      // Mirrors the service's own four-character floor. Both exist because a
      // three-character trigram probe matches almost anything, and the SQL
      // filter is what stops those rows being fetched at all.
      dataSource.query.mockResolvedValue([]);

      await repository.findAliasCandidates(5);

      expect(sqlOf(dataSource.query)).toContain('LENGTH(TRIM(token)) >= 4');
    });
  });

  describe('findDictionaryEntries', () => {
    beforeEach(() => dataSource.query.mockResolvedValue([]));

    it('offers only parentless rows', async () => {
      // MODEL rows hang off a make and are resolved scoped to it. A bare
      // search token carries no make context, so a model alias would attach
      // under whichever make scored highest — and under the wrong parent it
      // can never resolve again.
      await repository.findDictionaryEntries();

      expect(sqlOf(dataSource.query)).toContain('parent_id IS NULL');
    });

    it('offers only the flat dictionary types', async () => {
      await repository.findDictionaryEntries();

      expect(sqlOf(dataSource.query)).toContain(
        "dictionary_type IN ('MAKE', 'BODY_TYPE', 'COLOR')",
      );
    });

    it('ignores deactivated rows', async () => {
      await repository.findDictionaryEntries();

      expect(sqlOf(dataSource.query)).toContain('is_active = true');
    });

    describe('alias parsing', () => {
      const withAliases = async (aliases: unknown): Promise<string[]> => {
        dataSource.query.mockResolvedValue([
          { id: '1', dictionary_type: 'MAKE', canonical_value: 'Toyota', aliases },
        ]);
        const [row] = await repository.findDictionaryEntries();
        return row.aliases;
      };

      it('passes a real array through', async () => {
        await expect(withAliases(['toyata', 'toyta'])).resolves.toEqual(['toyata', 'toyta']);
      });

      it('parses a JSON string', async () => {
        // pg returns jsonb as a parsed value or a string depending on driver
        // configuration, and both shapes reach here in practice.
        await expect(withAliases('["toyata"]')).resolves.toEqual(['toyata']);
      });

      it('returns an empty list for malformed JSON rather than throwing', async () => {
        // One bad row would otherwise abort the whole promotion run.
        await expect(withAliases('{oops')).resolves.toEqual([]);
      });

      it('returns an empty list for null', async () => {
        await expect(withAliases(null)).resolves.toEqual([]);
      });

      it('drops non-string members', async () => {
        // The service calls normalize() on every alias; a number there would
        // throw mid-run.
        await expect(withAliases(['toyata', 5, null])).resolves.toEqual(['toyata']);
      });
    });
  });

  describe('addAlias', () => {
    it('reports true when a row was updated', async () => {
      dataSource.query.mockResolvedValue([{ id: 'mk-toyota' }]);

      await expect(repository.addAlias('mk-toyota', 'toyotta')).resolves.toBe(true);
      expect(dataSource.query.mock.calls[0][1]).toEqual(['mk-toyota', 'toyotta']);
    });

    it('reports false when the alias was already present', async () => {
      // The UPDATE carries its own NOT EXISTS guard, so a concurrent run that
      // already added it matches no row. The service counts that as skipped
      // rather than promoted.
      dataSource.query.mockResolvedValue([]);

      await expect(repository.addAlias('mk-toyota', 'toyotta')).resolves.toBe(false);
    });

    it('guards against adding a duplicate case-insensitively', async () => {
      dataSource.query.mockResolvedValue([]);

      await repository.addAlias('mk-toyota', 'Toyotta');

      expect(sqlOf(dataSource.query)).toContain('LOWER(existing.value) = LOWER($2)');
    });
  });
});
