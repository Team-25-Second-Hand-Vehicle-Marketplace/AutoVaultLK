import {
  coerceBoolean,
  coerceInteger,
  coerceNumber,
  coerceRegistrationNumber,
  coerceText,
  coerceYear,
} from '../../../../src/workers/etl-worker/pipeline/normalize/coerce';

describe('coerceNumber', () => {
  it.each([
    ['3500000', 3_500_000],
    ['3,500,000', 3_500_000],
    ['3 500 000', 3_500_000],
    ['Rs. 3,500,000', 3_500_000],
    ['LKR 3500000', 3_500_000],
    ['3,500,000/=', 3_500_000],
    ['45,000 km', 45_000],
    ['1500cc', 1_500],
    ['1500 c.c.', 1_500],
    ['  2500  ', 2_500],
    ['1234.56', 1234.56],
  ])('parses %s', (input, expected) => {
    expect(coerceNumber(input)).toBe(expected);
  });

  it.each([
    ['3.5M', 3_500_000],
    ['45K', 45_000],
    ['35 lakhs', 3_500_000],
  ])('expands the shorthand %s', (input, expected) => {
    // Dealer sheets carry these routinely; treating them as unparseable would
    // reject rows whose price is obvious to any human reader.
    expect(coerceNumber(input)).toBe(expected);
  });

  it('refuses an ambiguous comma rather than guessing', () => {
    // "3,5" is European decimal notation or a typo. Stripping the comma turns
    // 3.5 into 35 — a tenfold error in a price. Null lets the row be rejected
    // honestly instead.
    expect(coerceNumber('3,5')).toBeNull();
    expect(coerceNumber('1,23')).toBeNull();
  });

  it.each([['abc'], [''], ['   '], ['N/A'], ['-'], ['price on request']])(
    'returns null for %s',
    (input) => {
      expect(coerceNumber(input)).toBeNull();
    },
  );

  it('returns null rather than 0 for unparseable input', () => {
    // 0 is a price. Null is a missing value validateRows can reject.
    expect(coerceNumber('unknown')).not.toBe(0);
    expect(coerceNumber('unknown')).toBeNull();
  });

  it('handles null and undefined', () => {
    expect(coerceNumber(null)).toBeNull();
    expect(coerceNumber(undefined)).toBeNull();
  });
});

describe('coerceInteger', () => {
  it('accepts whole numbers', () => {
    expect(coerceInteger('45000')).toBe(45_000);
  });

  it('rejects a fractional value rather than rounding it', () => {
    // A fractional mileage is a data error. Rounding would hide it.
    expect(coerceInteger('45000.5')).toBeNull();
  });
});

describe('coerceYear', () => {
  const now = new Date('2026-06-01');

  it('passes a four-digit year through', () => {
    expect(coerceYear('2015', now)).toBe(2015);
  });

  it.each([
    ['15', 2015],
    ['98', 1998],
    ['05', 2005],
  ])('expands the two-digit year %s', (input, expected) => {
    expect(coerceYear(input, now)).toBe(expected);
  });

  it('does not expand a two-digit year into the future', () => {
    // "30" in 2026 must mean 1930, not 2030 — no dealer lists a vehicle that
    // has not been built yet.
    expect(coerceYear('30', now)).toBe(1930);
  });

  it('leaves range checking to validateRows', () => {
    // Out of range but parseable: the rejection with a reason belongs to the
    // single gate, not scattered through coercion.
    expect(coerceYear('1850', now)).toBe(1850);
  });
});

describe('coerceBoolean', () => {
  it.each([['yes', true], ['Y', true], ['1', true], ['true', true], ['negotiable', true]])(
    'reads %s as true',
    (input, expected) => {
      expect(coerceBoolean(input)).toBe(expected);
    },
  );

  it.each([['no', false], ['0', false], ['fixed', false], ['non-negotiable', false]])(
    'reads %s as false',
    (input, expected) => {
      expect(coerceBoolean(input)).toBe(expected);
    },
  );

  it('returns null for blank, not false', () => {
    // Blank means unknown. Defaulting to false is enrich's decision to make
    // explicitly, not a parsing accident.
    expect(coerceBoolean('')).toBeNull();
    expect(coerceBoolean('maybe')).toBeNull();
  });
});

describe('coerceText', () => {
  it('collapses internal whitespace and trims', () => {
    expect(coerceText('  Colombo   07 ')).toBe('Colombo 07');
  });

  it('returns null for an empty cell, never an empty string', () => {
    expect(coerceText('   ')).toBeNull();
  });
});

describe('coerceRegistrationNumber', () => {
  it.each([
    ['CAB-1234', 'CAB-1234'],
    ['cab 1234', 'CAB-1234'],
    ['CAB1234', 'CAB-1234'],
    ['  cab_1234  ', 'CAB-1234'],
    ['CAB/1234', 'CAB-1234'],
  ])('folds %s to a single canonical form', (input, expected) => {
    // These are compared against the UNIQUE partial index (FR-35.1). An
    // inconsistent format would let the same vehicle be listed twice — the
    // exact duplicate that index exists to prevent.
    expect(coerceRegistrationNumber(input)).toBe(expected);
  });

  it('keeps a province-prefixed plate intact', () => {
    expect(coerceRegistrationNumber('WP CAB-1234')).toBe('WP-CAB-1234');
  });

  it('returns null for a blank cell, since unregistered stock is legitimate', () => {
    expect(coerceRegistrationNumber('')).toBeNull();
    expect(coerceRegistrationNumber('  ')).toBeNull();
  });
});
