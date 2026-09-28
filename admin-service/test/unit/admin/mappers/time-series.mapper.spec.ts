import { mapTimeSeries } from '../../../../src/modules/admin/mappers/time-series.mapper';

describe('mapTimeSeries', () => {
  it('fills days with no rows as zero instead of omitting them', () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-04T00:00:00.000Z');

    const result = mapTimeSeries(
      {
        listingRows: [
          { day: '2026-08-01', count: 3 },
          { day: '2026-08-04', count: 1 },
        ],
        userRows: [],
        uploadRows: [],
      },
      from,
      to,
    );

    expect(result.listings).toEqual([
      { date: '2026-08-01', count: 3 },
      { date: '2026-08-02', count: 0 },
      { date: '2026-08-03', count: 0 },
      { date: '2026-08-04', count: 1 },
    ]);
    expect(result.users).toEqual([
      { date: '2026-08-01', count: 0 },
      { date: '2026-08-02', count: 0 },
      { date: '2026-08-03', count: 0 },
      { date: '2026-08-04', count: 0 },
    ]);
  });

  it('produces exactly one point for a single-day range', () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-01T00:00:00.000Z');

    const result = mapTimeSeries(
      { listingRows: [], userRows: [], uploadRows: [] },
      from,
      to,
    );

    expect(result.listings).toEqual([{ date: '2026-08-01', count: 0 }]);
  });

  it('accepts a Date object or a string for the grouped day', () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-01T00:00:00.000Z');

    const result = mapTimeSeries(
      {
        listingRows: [{ day: new Date('2026-08-01T00:00:00.000Z'), count: '5' }],
        userRows: [],
        uploadRows: [],
      },
      from,
      to,
    );

    expect(result.listings).toEqual([{ date: '2026-08-01', count: 5 }]);
  });
});
