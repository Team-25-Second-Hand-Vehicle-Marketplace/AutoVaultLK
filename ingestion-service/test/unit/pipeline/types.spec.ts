import {
  MAX_REJECTION_REASON_LENGTH,
  rejection,
  type RawRow,
} from '../../../src/workers/etl-worker/pipeline/types';

describe('rejection()', () => {
  const row: RawRow = { rowNumber: 7, raw: { make: 'Toyoat', model: 'Aqua' } };

  it('carries the row number and raw data through to rejected_records', () => {
    expect(rejection(row, 'unknown make')).toEqual({
      rowNumber: 7,
      rawData: { make: 'Toyoat', model: 'Aqua' },
      reason: 'unknown make',
    });
  });

  // rejected_records.reason is varchar(500). An over-long reason throws at
  // INSERT time and takes the whole chunk's rejections with it — so a bad
  // error message would cost more than the bad row it describes.
  it('clamps a reason longer than the column width', () => {
    const result = rejection(row, 'x'.repeat(MAX_REJECTION_REASON_LENGTH + 200));

    expect(result.reason).toHaveLength(MAX_REJECTION_REASON_LENGTH);
    expect(result.reason.endsWith('…')).toBe(true);
  });

  it('leaves a reason at exactly the limit untouched', () => {
    const exact = 'y'.repeat(MAX_REJECTION_REASON_LENGTH);

    expect(rejection(row, exact).reason).toBe(exact);
  });

  it('preserves an empty raw row rather than dropping the key', () => {
    expect(rejection({ rowNumber: 1, raw: {} }, 'empty row').rawData).toEqual({});
  });
});
