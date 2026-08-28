import { tokenize } from '../../../../src/modules/search/parser/tokenize';
import {
  compact,
  consumeSpan,
  exactClosedHit,
  exactSpanHit,
  fuzzyClosedHit,
  fuzzySpanHit,
  indexEntries,
  isBodyType,
  isCondition,
  isDriveType,
  isFuelType,
  isTransmission,
  isVehicleType,
  joinSpan,
  spanIsOpen,
  spanIsPresent,
} from '../../../../src/modules/search/parser/vocabulary';
import type { DictionaryEntry } from '../../../../src/modules/search/parser/types';

function entry(canonical: string, aliases: string[] = []): DictionaryEntry {
  return { canonical, aliases, vehicleTypes: ['CAR'] };
}

describe('compact', () => {
  it('strips spaces, hyphens, dots, and underscores and lowercases', () => {
    expect(compact('Land Cruiser')).toBe('landcruiser');
    expect(compact('land-cruiser')).toBe('landcruiser');
    expect(compact('LAND_CRUISER')).toBe('landcruiser');
    expect(compact('land.cruiser')).toBe('landcruiser');
  });
});

describe('indexEntries / exactSpanHit', () => {
  const TOYOTA = entry('Toyota', ['toyata']);
  const HONDA = entry('Honda');
  const index = indexEntries([TOYOTA, HONDA]);

  it('indexes both the canonical value and its aliases', () => {
    expect(index.get('toyota')).toEqual([TOYOTA]);
    expect(index.get('toyata')).toEqual([TOYOTA]);
  });

  it('finds a unique exact match by compacted key', () => {
    const tokens = tokenize('toyota aqua');
    const hit = exactSpanHit(tokens, 0, 2, index);
    expect(hit).toMatchObject({ start: 0, span: 1, entry: TOYOTA });
  });

  it('prefers the longest matching span', () => {
    const multiWord = entry('Land Cruiser');
    const idx = indexEntries([multiWord]);
    const tokens = tokenize('land cruiser prado');
    const hit = exactSpanHit(tokens, 0, 2, idx);
    expect(hit?.span).toBe(2);
  });

  it('returns undefined when nothing matches', () => {
    const tokens = tokenize('nissan aqua');
    expect(exactSpanHit(tokens, 0, 2, index)).toBeUndefined();
  });

  it('returns undefined for an ambiguous compact key shared by two entries', () => {
    const dup1 = entry('ABC');
    const dup2 = entry('A-B-C');
    const idx = indexEntries([dup1, dup2]);
    const tokens = tokenize('abc');
    expect(exactSpanHit(tokens, 0, 1, idx)).toBeUndefined();
  });
});

describe('fuzzySpanHit', () => {
  const TOYOTA = entry('Toyota');
  const HONDA = entry('Honda');

  it('matches a misspelling above the threshold', () => {
    const tokens = tokenize('toyata aqua');
    const hit = fuzzySpanHit(tokens, 0, 1, [TOYOTA, HONDA], { rejectDigitAdjacent: false });
    expect(hit?.entry).toBe(TOYOTA);
  });

  it('rejects a probe shorter than 4 characters even if it would otherwise match', () => {
    const short = entry('BMW');
    const tokens = tokenize('bmv');
    const hit = fuzzySpanHit(tokens, 0, 1, [short], { rejectDigitAdjacent: false });
    expect(hit).toBeUndefined();
  });

  it('rejects a digit-adjacent span when rejectDigitAdjacent is true', () => {
    const tokens = tokenize('toyata 2018');
    const hit = fuzzySpanHit(tokens, 0, 1, [TOYOTA], { rejectDigitAdjacent: true });
    expect(hit).toBeUndefined();
  });

  it('requires a margin over the runner-up, not just crossing the threshold', () => {
    // "aqxa" scores exactly 0.4 against both "aqua" and "aqva" — a genuine
    // tie, well inside the 0.05 margin — so neither should win.
    const near1 = entry('Aqua');
    const near2 = entry('Aqva');
    const tokens = tokenize('aqxa');
    const hit = fuzzySpanHit(tokens, 0, 1, [near1, near2], {
      rejectDigitAdjacent: false,
      threshold: 0.3,
    });
    expect(hit).toBeUndefined();
  });
});

describe('spanIsOpen / spanIsPresent', () => {
  it('spanIsOpen rejects a numeric token', () => {
    const tokens = tokenize('2018 toyota');
    expect(spanIsOpen(tokens, 0, 1)).toBe(false);
  });

  it('spanIsOpen rejects a stopword', () => {
    const tokens = tokenize('the toyota');
    expect(spanIsOpen(tokens, 0, 1)).toBe(false);
  });

  it('spanIsOpen rejects an already-consumed token', () => {
    const tokens = tokenize('toyota aqua');
    tokens[0].consumed = true;
    expect(spanIsOpen(tokens, 0, 1)).toBe(false);
  });

  it('spanIsPresent allows a numeric token (e.g. "4 wheel drive")', () => {
    const tokens = tokenize('4 wheel drive');
    expect(spanIsPresent(tokens, 0, 3)).toBe(true);
  });

  it('spanIsPresent still rejects a stopword or consumed token', () => {
    const tokens = tokenize('the wheel');
    expect(spanIsPresent(tokens, 0, 2)).toBe(false);
  });
});

describe('joinSpan / consumeSpan', () => {
  it('joinSpan joins the normalized text of a token range with spaces', () => {
    const tokens = tokenize('land cruiser prado');
    expect(joinSpan(tokens, 0, 2)).toBe('land cruiser');
  });

  it('consumeSpan marks every token in the range as consumed', () => {
    const tokens = tokenize('land cruiser prado');
    consumeSpan(tokens, 0, 2);
    expect(tokens[0].consumed).toBe(true);
    expect(tokens[1].consumed).toBe(true);
    expect(tokens[2].consumed).toBe(false);
  });
});

describe('exactClosedHit', () => {
  it('matches a closed single word (e.g. "suv")', () => {
    const tokens = tokenize('suv');
    expect(exactClosedHit(tokens, 0, 1)).toEqual({
      field: 'vehicleType',
      value: 'SUV',
      start: 0,
      span: 1,
    });
  });

  it('matches a multi-word closed phrase (e.g. "three wheeler")', () => {
    const tokens = tokenize('three wheeler for sale');
    expect(exactClosedHit(tokens, 0, 2)).toEqual({
      field: 'vehicleType',
      value: 'THREE_WHEELER',
      start: 0,
      span: 2,
    });
  });

  it('prefers a two-word phrase over a shorter single-word match at the same start', () => {
    const tokens = tokenize('second hand toyota');
    expect(exactClosedHit(tokens, 0, 2)).toMatchObject({ field: 'condition', value: 'USED', span: 2 });
  });

  it('returns undefined for an unrecognized word', () => {
    const tokens = tokenize('toyota');
    expect(exactClosedHit(tokens, 0, 1)).toBeUndefined();
  });

  it('recognizes common misspellings mapped directly in CLOSED_SINGLES (e.g. "disel")', () => {
    const tokens = tokenize('disel car');
    expect(exactClosedHit(tokens, 0, 1)).toMatchObject({ field: 'fuelType', value: 'DIESEL' });
  });
});

describe('fuzzyClosedHit', () => {
  it('matches a near-miss typo of a closed enum word above the tighter 0.52 threshold', () => {
    const tokens = tokenize('hachback');
    expect(fuzzyClosedHit(tokens, 0)).toMatchObject({ field: 'bodyType', value: 'HATCHBACK' });
  });

  it('does NOT match "volkswagon" against "wagon" — the documented collision case', () => {
    const tokens = tokenize('volkswagon');
    expect(fuzzyClosedHit(tokens, 0)).toBeUndefined();
  });

  it('rejects a probe shorter than 4 characters', () => {
    const tokens = tokenize('van');
    expect(fuzzyClosedHit(tokens, 0)).toBeUndefined();
  });
});

describe('type guards', () => {
  it('isVehicleType / isCondition / isFuelType / isTransmission recognize real enum values', () => {
    expect(isVehicleType('CAR')).toBe(true);
    expect(isVehicleType('NOT_A_TYPE')).toBe(false);
    expect(isCondition('USED')).toBe(true);
    expect(isFuelType('HYBRID')).toBe(true);
    expect(isTransmission('AUTOMATIC')).toBe(true);
  });

  it('isBodyType / isDriveType recognize known spec-key values', () => {
    expect(isBodyType('SEDAN')).toBe(true);
    expect(isBodyType('NOT_A_BODY')).toBe(false);
    expect(isDriveType('AWD')).toBe(true);
    expect(isDriveType('NOT_A_DRIVE')).toBe(false);
  });
});
