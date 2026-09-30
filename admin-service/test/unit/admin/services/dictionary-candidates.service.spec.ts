import { DictionaryCandidatesService } from '../../../../src/modules/admin/services/dictionary-candidates.service';

describe('DictionaryCandidatesService', () => {
  const repository = {
    findCandidates: jest.fn(),
    findMakes: jest.fn(),
  };
  const service = new DictionaryCandidatesService(repository as never);

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findMakes.mockResolvedValue([
      { id: 'dict-toyota', canonicalValue: 'Toyota' },
      { id: 'dict-honda', canonicalValue: 'Honda' },
    ]);
  });

  const candidate = (overrides: Record<string, unknown> = {}) => ({
    normalizedValue: 'byd',
    displayValue: 'BYD',
    occurrences: 3,
    dealerCount: 2,
    samples: [],
    ...overrides,
  });

  it('requests candidates at the lower, human-reviewed threshold', async () => {
    repository.findCandidates.mockResolvedValue([]);

    await service.listMakeCandidates();

    // Deliberately lower than AliasPromotionService's 5: a human reviews
    // every entry here, so surfacing a real new make sooner outweighs
    // filtering one extra stray typo.
    expect(repository.findCandidates).toHaveBeenCalledWith(2);
  });

  it('scores a mangled typo as a close match to the real make', async () => {
    repository.findCandidates.mockResolvedValue([
      candidate({ displayValue: 'Toyott' }),
    ]);

    const [result] = await service.listMakeCandidates();

    expect(result.closestMatch).not.toBeNull();
    expect(result.closestMatch?.id).toBe('dict-toyota');
    expect(result.closestMatch?.canonicalValue).toBe('Toyota');
    expect(result.closestMatch?.score).toBeGreaterThan(0.3);
  });

  it('reports no close match for a genuinely new make', async () => {
    repository.findCandidates.mockResolvedValue([
      candidate({ displayValue: 'BYD' }),
    ]);

    const [result] = await service.listMakeCandidates();

    expect(result.closestMatch).toBeNull();
  });

  it('picks the single best match rather than the first make above the floor', async () => {
    repository.findCandidates.mockResolvedValue([
      candidate({ displayValue: 'Toyota' }),
    ]);

    const [result] = await service.listMakeCandidates();

    expect(result.closestMatch?.canonicalValue).toBe('Toyota');
  });

  it('passes through occurrence, dealer count and samples unchanged', async () => {
    const samples = [{ make: 'BYD', model: 'Seal', description: 'EV sedan' }];
    repository.findCandidates.mockResolvedValue([
      candidate({ occurrences: 5, dealerCount: 3, samples }),
    ]);

    const [result] = await service.listMakeCandidates();

    expect(result.rawValue).toBe('byd');
    expect(result.occurrences).toBe(5);
    expect(result.dealerCount).toBe(3);
    expect(result.samples).toEqual(samples);
  });

  it('returns an empty list when nothing is above the occurrence threshold', async () => {
    repository.findCandidates.mockResolvedValue([]);

    await expect(service.listMakeCandidates()).resolves.toEqual([]);
  });
});
