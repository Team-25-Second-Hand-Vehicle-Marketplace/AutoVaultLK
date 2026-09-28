import { mapRejections } from '../../../../src/modules/admin/mappers/rejections.mapper';
import type { RejectedRecordView } from '../../../../src/infrastructure/database/entities/rejected-record.view-entity';

function row(overrides: Partial<RejectedRecordView> = {}): RejectedRecordView {
  return {
    id: 'r1',
    uploadJobId: 'job-1',
    stage: 'VALIDATE_ROWS',
    rowNumber: 1,
    rawData: { make: 'Toyoat' },
    reason: 'Unrecognised make',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('mapRejections', () => {
  it('maps rows and computes totalPages from total/limit', () => {
    const result = mapRejections([row()], 51, 1, 50);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      rowNumber: 1,
      stage: 'VALIDATE_ROWS',
      reason: 'Unrecognised make',
      rawDataTruncated: false,
    });
    expect(result.totalPages).toBe(2);
  });

  it('caps rawData at 24 keys and flags it as truncated', () => {
    const wideRow: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) wideRow[`col${i}`] = i;

    const result = mapRejections([row({ rawData: wideRow })], 1, 1, 50);

    expect(Object.keys(result.items[0].rawData)).toHaveLength(24);
    expect(result.items[0].rawDataTruncated).toBe(true);
  });

  it('treats a null rawData as an empty, non-truncated object', () => {
    const result = mapRejections([row({ rawData: null as never })], 1, 1, 50);

    expect(result.items[0].rawData).toEqual({});
    expect(result.items[0].rawDataTruncated).toBe(false);
  });
});
