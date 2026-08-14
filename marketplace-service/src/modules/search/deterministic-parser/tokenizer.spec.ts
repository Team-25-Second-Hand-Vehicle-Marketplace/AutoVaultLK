import { tokenize } from './tokenizer';

/** Convenience: the token texts, in order. */
const texts = (q: string) => tokenize(q).map((t) => t.text);

/** Convenience: only the tokens a later stage is allowed to claim. */
const claimable = (q: string) =>
  tokenize(q)
    .filter((t) => t.role === 'unconsumed')
    .map((t) => t.text);

describe('tokenize', () => {
  describe('degenerate input', () => {
    it('returns an empty array for an empty string', () => {
      expect(tokenize('')).toEqual([]);
    });

    it('returns an empty array for whitespace only', () => {
      expect(tokenize('   \t\n  ')).toEqual([]);
    });

    it('returns an empty array for punctuation only', () => {
      expect(tokenize('!!! ??? ...')).toEqual([]);
    });

    it('does not throw on non-string input', () => {
      expect(tokenize(undefined as unknown as string)).toEqual([]);
      expect(tokenize(null as unknown as string)).toEqual([]);
    });

    it('masks every token when the query is all stopwords', () => {
      const tokens = tokenize('i am looking for a vehicle');
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every((t) => t.role === 'stopword')).toBe(true);
      expect(claimable('i am looking for a vehicle')).toEqual([]);
    });
  });

  describe('lowercasing', () => {
    it('lowercases while preserving the original in raw', () => {
      const [token] = tokenize('TOYOTA');
      expect(token.text).toBe('toyota');
    });
  });

  describe('punctuation — the cases a blanket strip would corrupt', () => {
    it('keeps a comma-separated price as one number', () => {
      expect(texts('5,000,000')).toEqual(['5000000']);
    });

    it('handles multiple comma groups in one number', () => {
      expect(texts('12,345,678')).toEqual(['12345678']);
    });

    it('splits a currency prefix off the number', () => {
      expect(texts('Rs.5,000,000')).toEqual(['rs', '5000000']);
    });

    it('preserves a decimal point between digits', () => {
      expect(texts('1.5')).toEqual(['1.5']);
    });

    it('preserves the decimal in an abbreviated price and splits the unit', () => {
      expect(texts('8.5m')).toEqual(['8.5', 'm']);
    });

    it('drops sentence-ending punctuation', () => {
      expect(texts('toyota aqua.')).toEqual(['toyota', 'aqua']);
    });

    it('keeps a hyphenated make intact', () => {
      expect(texts('Mercedes-Benz')).toEqual(['mercedes-benz']);
    });

    it('keeps a hyphenated model intact', () => {
      expect(texts('CR-V')).toEqual(['cr-v']);
    });

    it('rewrites a hyphenated numeric range into the explicit "to" form', () => {
      expect(texts('2015-2018')).toEqual(['2015', 'to', '2018']);
    });

    it('rewrites an en-dash range the same way', () => {
      expect(texts('2015–2018')).toEqual(['2015', 'to', '2018']);
    });

    it('strips symbols that carry no structure', () => {
      expect(texts('toyota @ #aqua!')).toEqual(['toyota', 'aqua']);
    });
  });

  describe('numeric/unit splitting', () => {
    it('splits a magnitude suffix off a number', () => {
      expect(texts('5m')).toEqual(['5', 'm']);
      expect(texts('800k')).toEqual(['800', 'k']);
    });

    it('splits a unit off a mileage figure', () => {
      expect(texts('50000km')).toEqual(['50000', 'km']);
    });

    it('splits an engine displacement into number and unit', () => {
      expect(texts('150cc')).toEqual(['150', 'cc']);
    });

    it('preserves a trailing + on a glued spec value', () => {
      expect(texts('250cc+')).toEqual(['250', 'cc+']);
    });

    it('does not split letter-then-digit model names', () => {
      expect(texts('X5')).toEqual(['x5']);
      expect(texts('C200')).toEqual(['c200']);
    });
  });

  describe('stopword masking', () => {
    it('masks generic stopwords but leaves them in the array', () => {
      const tokens = tokenize('a toyota for me');
      expect(tokens.map((t) => t.text)).toEqual(['a', 'toyota', 'for', 'me']);
      expect(tokens.map((t) => t.role)).toEqual([
        'stopword',
        'unconsumed',
        'stopword',
        'stopword',
      ]);
    });

    it('leaves domain operators unconsumed for the numeric stage to read', () => {
      // "under" must survive tokenization — it is the only thing that makes
      // 5000000 a ceiling rather than a floor.
      expect(claimable('under 5000000')).toEqual(['under', '5000000']);
    });

    it('leaves range operators unconsumed', () => {
      expect(claimable('between 2015 to 2018')).toEqual(['between', '2015', 'to', '2018']);
    });

    it('does not mask words that are also vehicle vocabulary', () => {
      // "land" is half of "Land Cruiser"; "mini" is a make. Neither may be
      // treated as filler.
      expect(claimable('land cruiser')).toEqual(['land', 'cruiser']);
      expect(claimable('mini cooper')).toEqual(['mini', 'cooper']);
    });
  });

  describe('index integrity', () => {
    it('assigns contiguous indices matching the array position', () => {
      const tokens = tokenize('i want a toyota aqua under 5 million');
      tokens.forEach((token, i) => expect(token.index).toBe(i));
    });

    it('keeps masked stopwords occupying their index', () => {
      // Adjacency is load-bearing: if "for" were removed, "toyota" and "5"
      // would become neighbours and the digit-adjacency gate would misfire.
      const tokens = tokenize('toyota for 5000000');
      expect(tokens).toHaveLength(3);
      expect(tokens[1].text).toBe('for');
      expect(tokens[1].role).toBe('stopword');
    });
  });

  describe('initial token state', () => {
    it('starts every token with digitAdjacent false', () => {
      const tokens = tokenize('toyota 5 seater');
      expect(tokens.every((t) => t.digitAdjacent === false)).toBe(true);
    });
  });

  describe('input bounds', () => {
    it('caps the token count on a pathologically long query', () => {
      const tokens = tokenize('toyota '.repeat(500));
      expect(tokens.length).toBeLessThanOrEqual(64);
    });
  });

  describe('whitespace and casing normalization', () => {
    it('collapses repeated spaces', () => {
      expect(texts('toyota    aqua')).toEqual(['toyota', 'aqua']);
    });

    it('treats tabs and newlines as separators', () => {
      expect(texts('toyota\taqua\nprius')).toEqual(['toyota', 'aqua', 'prius']);
    });

    it('is case insensitive end to end', () => {
      expect(texts('TOYOTA AQUA')).toEqual(texts('toyota aqua'));
      expect(texts('ToYoTa')).toEqual(['toyota']);
    });

    it('trims leading and trailing whitespace', () => {
      expect(texts('   toyota   ')).toEqual(['toyota']);
    });
  });

  describe('trailing and mixed punctuation on prices', () => {
    it('strips a trailing slash-dash from a price', () => {
      expect(texts('Rs.5,000,000/-')).toEqual(['rs', '5000000']);
    });

    it('handles a spaced hyphen range', () => {
      expect(texts('2015 - 2018')).toEqual(['2015', 'to', '2018']);
    });

    it('keeps a bare decimal that is not a magnitude', () => {
      expect(texts('prius 1.8')).toEqual(['prius', '1.8']);
    });

    it('splits an engine size suffix off a decimal', () => {
      expect(texts('1.5L turbo')).toEqual(['1.5', 'l', 'turbo']);
    });
  });

  describe('known limitation — glued operator and number', () => {
    it('does not split a letter-then-digit run, even when it is a typo', () => {
      // "under5m" stays one token because the split rule is deliberately
      // digit-then-letter only. Reversing it would split model names like
      // "X5" and "C200", which are real dictionary entries and matter far
      // more than this typo. The token falls through every stage and reaches
      // semanticText, which is a harmless outcome.
      //
      // This test documents the trade-off so the rule is not "fixed" later
      // without weighing the model-name cost.
      expect(texts('under5m')).toEqual(['under5m']);
    });
  });

  describe('realistic queries', () => {
    it('tokenizes a full buyer query', () => {
      expect(texts('Toyota Aqua under 5 million automatic')).toEqual([
        'toyota',
        'aqua',
        'under',
        '5',
        'million',
        'automatic',
      ]);
    });

    it('tokenizes a query mixing filler, numbers and units', () => {
      expect(texts('I want a hybrid car under Rs. 8,500,000 with 50000km')).toEqual([
        'i',
        'want',
        'a',
        'hybrid',
        'car',
        'under',
        'rs',
        '8500000',
        'with',
        '50000',
        'km',
      ]);
    });
  });
});
