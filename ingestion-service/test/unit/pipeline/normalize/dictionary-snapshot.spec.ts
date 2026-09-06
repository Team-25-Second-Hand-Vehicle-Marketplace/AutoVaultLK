import {
  AMBIGUITY_MARGIN,
  CONFIDENCE_ALIAS,
  CONFIDENCE_EXACT,
  CONFIDENCE_FUZZY,
  InMemoryDictionarySnapshot,
  TRIGRAM_THRESHOLD,
  type DictionaryRow,
} from '../../../../src/workers/etl-worker/pipeline/normalize/dictionary-snapshot';

const row = (o: Partial<DictionaryRow> & { id: string; canonicalValue: string }): DictionaryRow => ({
  parentId: null,
  dictionaryType: 'MAKE',
  aliases: [],
  vehicleTypes: [],
  ...o,
});

const TOYOTA = row({
  id: 'mk-toyota',
  canonicalValue: 'Toyota',
  aliases: ['toyata', 'toyta'],
  vehicleTypes: ['CAR', 'SUV', 'VAN'],
});
const HONDA = row({ id: 'mk-honda', canonicalValue: 'Honda', vehicleTypes: ['CAR'] });
const CIVIC = row({
  id: 'md-civic',
  canonicalValue: 'Civic',
  dictionaryType: 'MODEL',
  parentId: 'mk-honda',
  vehicleTypes: ['CAR'],
});
const COROLLA = row({
  id: 'md-corolla',
  canonicalValue: 'Corolla',
  dictionaryType: 'MODEL',
  parentId: 'mk-toyota',
  aliases: ['corrola'],
  vehicleTypes: ['CAR'],
});
const WAGON_R = row({
  id: 'md-wagonr',
  canonicalValue: 'Wagon R',
  dictionaryType: 'MODEL',
  parentId: 'mk-toyota',
  vehicleTypes: ['CAR'],
});
const SEDAN = row({
  id: 'bt-sedan',
  canonicalValue: 'SEDAN',
  dictionaryType: 'BODY_TYPE',
  aliases: ['saloon'],
});

describe('InMemoryDictionarySnapshot', () => {
  const snapshot = new InMemoryDictionarySnapshot([
    TOYOTA, HONDA, CIVIC, COROLLA, WAGON_R, SEDAN,
  ]);

  describe('exact matches', () => {
    it('resolves a canonical make at full confidence', () => {
      expect(snapshot.resolveMake('Toyota')).toEqual({
        id: 'mk-toyota',
        canonical: 'Toyota',
        vehicleTypes: ['CAR', 'SUV', 'VAN'],
        confidence: CONFIDENCE_EXACT,
      });
    });

    it('is case-insensitive', () => {
      expect(snapshot.resolveMake('TOYOTA')?.id).toBe('mk-toyota');
      expect(snapshot.resolveMake('toyota')?.id).toBe('mk-toyota');
    });

    // Dealers write "Wagon R", "wagon-r" and "wagonr" interchangeably.
    it.each([['Wagon R'], ['wagon-r'], ['wagonr'], ['WAGON  R'], ['wagon_r']])(
      'folds punctuation and spacing in %j',
      (raw) => {
        expect(snapshot.resolveModel(raw, 'mk-toyota')?.id).toBe('md-wagonr');
      },
    );

    it('carries vehicleTypes through for vehicle_type derivation', () => {
      expect(snapshot.resolveModel('Civic', 'mk-honda')?.vehicleTypes).toEqual(['CAR']);
    });
  });

  describe('alias matches', () => {
    it('resolves a known misspelling at alias confidence', () => {
      expect(snapshot.resolveMake('Toyata')).toEqual(
        expect.objectContaining({ id: 'mk-toyota', confidence: CONFIDENCE_ALIAS }),
      );
    });

    it('resolves a body-type alias', () => {
      expect(snapshot.resolve('BODY_TYPE', 'saloon')).toEqual(
        expect.objectContaining({ canonical: 'SEDAN', confidence: CONFIDENCE_ALIAS }),
      );
    });

    // The canonical spelling must win over an alias that shares its key.
    it('prefers a canonical hit over an alias hit', () => {
      const shared = new InMemoryDictionarySnapshot([
        row({ id: 'a', canonicalValue: 'Civic' }),
        row({ id: 'b', canonicalValue: 'Something', aliases: ['civic'] }),
      ]);

      expect(shared.resolveMake('Civic')).toEqual(
        expect.objectContaining({ id: 'a', confidence: CONFIDENCE_EXACT }),
      );
    });
  });

  describe('model scoping', () => {
    // A Civic must not resolve when the row says Toyota.
    it('does not resolve a model belonging to another make', () => {
      expect(snapshot.resolveModel('Civic', 'mk-toyota')).toBeNull();
      expect(snapshot.resolveModel('Civic', 'mk-honda')?.id).toBe('md-civic');
    });

    // If the make is unresolved the model cannot be trusted either.
    it('returns null when the make id is null', () => {
      expect(snapshot.resolveModel('Civic', null)).toBeNull();
    });

    it('does not match a MODEL through resolveMake', () => {
      expect(snapshot.resolveMake('Civic')).toBeNull();
    });
  });

  describe('fuzzy matches', () => {
    it('resolves an unlisted misspelling at fuzzy confidence', () => {
      expect(snapshot.resolveModel('Corollla', 'mk-toyota')).toEqual(
        expect.objectContaining({ id: 'md-corolla', confidence: CONFIDENCE_FUZZY }),
      );
    });

    // Below 4 chars a trigram probe matches almost anything.
    it('refuses to fuzzy-match a very short probe', () => {
      expect(new InMemoryDictionarySnapshot([TOYOTA]).resolveMake('Toy')).toBeNull();
    });

    it('returns null when nothing clears the similarity threshold', () => {
      expect(snapshot.resolveMake('Lamborghini')).toBeNull();
    });

    /**
     * Two near-equal candidates must not be resolved by a coin flip — that
     * would write an arbitrary make into a dealer's inventory. Leaving it
     * unresolved drops the row's confidence and routes it to Groq instead.
     */
    it('refuses an ambiguous fuzzy match', () => {
      // Symmetric candidates: 'Corolla' scores identically against both
      // (0.750 each, margin 0.000), so picking either would be a coin flip.
      const ambiguous = new InMemoryDictionarySnapshot([
        row({ id: 'a', canonicalValue: 'Corollx' }),
        row({ id: 'b', canonicalValue: 'Corolly' }),
      ]);

      expect(ambiguous.resolveMake('Corolla')).toBeNull();
    });

    it('resolves when one candidate clearly beats the other', () => {
      // Same shape, but 'Carola' beats 'Carla' by 0.269 — well over the margin.
      const clear = new InMemoryDictionarySnapshot([
        row({ id: 'a', canonicalValue: 'Carola' }),
        row({ id: 'b', canonicalValue: 'Carla' }),
      ]);

      expect(clear.resolveMake('Carol')?.id).toBe('a');
    });

    it('accepts a fuzzy match that clears the runner-up by the margin', () => {
      const clear = new InMemoryDictionarySnapshot([
        row({ id: 'a', canonicalValue: 'Corolla' }),
        row({ id: 'b', canonicalValue: 'Zzzzzzz' }),
      ]);

      expect(clear.resolveMake('Corolla ')?.id).toBe('a');
    });
  });

  describe('degenerate input', () => {
    it.each([[''], ['   '], ['---']])('returns null for %j', (raw) => {
      expect(snapshot.resolveMake(raw)).toBeNull();
    });

    it('survives an empty dictionary', () => {
      expect(new InMemoryDictionarySnapshot([]).resolveMake('Toyota')).toBeNull();
    });
  });

  describe('thresholds', () => {
    // Pinned: these must stay in step with search's parser, or the two halves
    // accept different misspellings for the same dealer input.
    it('matches search-side constants', () => {
      expect(TRIGRAM_THRESHOLD).toBe(0.45);
      expect(AMBIGUITY_MARGIN).toBe(0.05);
    });

    it('orders confidence exact > alias > fuzzy', () => {
      expect(CONFIDENCE_EXACT).toBeGreaterThan(CONFIDENCE_ALIAS);
      expect(CONFIDENCE_ALIAS).toBeGreaterThan(CONFIDENCE_FUZZY);
    });
  });
});
