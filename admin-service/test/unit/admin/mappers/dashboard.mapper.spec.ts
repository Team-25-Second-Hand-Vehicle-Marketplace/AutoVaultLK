import { mapDashboard } from '../../../../src/modules/admin/mappers/dashboard.mapper';

describe('mapDashboard', () => {
  it('maps SQL aggregates onto dashboard tiles (FR-48)', () => {
    const dto = mapDashboard({
      liveListings: 12,
      totalUsers: 40,
      dealers: 8,
      pendingDealers: 3,
      uploadsByStatus: [
        { status: 'COMPLETED', count: '4' },
        { status: 'FAILED', count: 1 },
      ],
      notificationTotal: 10,
      notificationSent: 8,
      notificationFailed: 2,
      recentAuditCount: 5,
    });

    expect(dto.listings.live).toBe(12);
    expect(dto.users).toEqual({ total: 40, dealers: 8, pendingDealers: 3 });
    expect(dto.uploads.byStatus).toEqual({ COMPLETED: 4, FAILED: 1 });
    expect(dto.notifications.deliveryRate).toBe(0.8);
    expect(dto.audit.recentCount).toBe(5);
  });

  it('uses a zero delivery rate when no notifications exist', () => {
    const dto = mapDashboard({
      liveListings: 0,
      totalUsers: 0,
      dealers: 0,
      pendingDealers: 0,
      uploadsByStatus: [],
      notificationTotal: 0,
      notificationSent: 0,
      notificationFailed: 0,
      recentAuditCount: 0,
    });

    expect(dto.notifications.deliveryRate).toBe(0);
    expect(dto.uploads.byStatus).toEqual({});
  });
});
