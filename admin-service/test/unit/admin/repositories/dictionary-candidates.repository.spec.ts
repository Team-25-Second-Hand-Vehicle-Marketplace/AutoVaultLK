import { DictionaryCandidatesRepository } from '../../../../src/modules/admin/repositories/dictionary-candidates.repository';

describe('DictionaryCandidatesRepository', () => {
  const rejectedRecords = { query: jest.fn() };
  const dictionary = { find: jest.fn() };
  const dismissals = { query: jest.fn() };

  const repository = new DictionaryCandidatesRepository(
    rejectedRecords as never,
    dictionary as never,
    dismissals as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findCandidates', () => {
    it('scopes to VALIDATE_ROWS make-not-recognised rejections and passes the threshold', async () => {
      rejectedRecords.query.mockResolvedValue([]);

      await repository.findCandidates(2);

      const [sql, params] = rejectedRecords.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain("r.stage = 'VALIDATE_ROWS'");
      expect(sql).toContain('could not be recognised');
      expect(sql).toContain('HAVING COUNT(*) >= $1');
      expect(params).toEqual([2]);
    });

    it('excludes candidates an admin already dismissed', async () => {
      rejectedRecords.query.mockResolvedValue([]);

      await repository.findCandidates(2);

      const [sql] = rejectedRecords.query.mock.calls[0] as [string];
      expect(sql).toContain('admin.dictionary_candidate_dismissals');
      expect(sql).toContain('NOT EXISTS');
    });

    it('maps the aggregated row shape into typed candidates', async () => {
      rejectedRecords.query.mockResolvedValue([
        {
          normalized_make: 'byd',
          display_value: 'BYD',
          occurrences: '3',
          dealer_count: '2',
          samples: [{ make: 'BYD', model: 'Seal', description: null }],
        },
      ]);

      const result = await repository.findCandidates(2);

      expect(result).toEqual([
        {
          normalizedValue: 'byd',
          displayValue: 'BYD',
          occurrences: 3,
          dealerCount: 2,
          samples: [{ make: 'BYD', model: 'Seal', description: null }],
        },
      ]);
    });
  });

  describe('findMakes', () => {
    it('reads only active MAKE entries', async () => {
      dictionary.find.mockResolvedValue([]);

      await repository.findMakes();

      expect(dictionary.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dictionaryType: 'MAKE', isActive: true },
        }),
      );
    });
  });

  describe('dismiss', () => {
    it('inserts a dismissal that no-ops on conflict', async () => {
      dismissals.query.mockResolvedValue(undefined);

      await repository.dismiss('asdkj', 'admin-1');

      const [sql, params] = dismissals.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain(
        'ON CONFLICT (dictionary_type, raw_value) DO NOTHING',
      );
      expect(params).toEqual(['asdkj', 'admin-1']);
    });
  });
});
