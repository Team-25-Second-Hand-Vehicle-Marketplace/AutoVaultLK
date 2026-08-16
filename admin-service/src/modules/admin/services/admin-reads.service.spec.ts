import { BadRequestException } from '@nestjs/common';
import { AdminReadsService } from './admin-reads.service';
import { mapDashboard } from '../mappers/dashboard.mapper';

describe('AdminReadsService', () => {
  const raw = {
    liveListings: 3,
    totalUsers: 10,
    dealers: 4,
    pendingDealers: 1,
    uploadsByStatus: [{ status: 'COMPLETED', count: 2 }],
    notificationTotal: 5,
    notificationSent: 4,
    notificationFailed: 1,
    recentAuditCount: 2,
  };

  function makeService() {
    const reads = {
      loadDashboardRaw: jest.fn().mockResolvedValue(raw),
      listUsers: jest.fn().mockResolvedValue([]),
      listUploads: jest.fn().mockResolvedValue([]),
      loadReports: jest.fn().mockResolvedValue({ listings: {} }),
    };
    const auditLogs = { search: jest.fn().mockResolvedValue([]) };
    const service = new AdminReadsService(reads as never, auditLogs as never);
    return { service, reads, auditLogs };
  }

  it('maps dashboard SQL aggregates', async () => {
    const { service } = makeService();
    await expect(service.dashboard()).resolves.toEqual(mapDashboard(raw));
  });

  it('passes verificationStatus through to the user list', async () => {
    const { service, reads } = makeService();
    await service.listUsers('PENDING');
    expect(reads.listUsers).toHaveBeenCalledWith('PENDING');
  });

  it('rejects a report range where from is after to', () => {
    const { service, reads } = makeService();
    const from = new Date('2026-08-02');
    const to = new Date('2026-08-01');
    expect(() => service.reports(from, to)).toThrow(BadRequestException);
    expect(reads.loadReports).not.toHaveBeenCalled();
  });

  it('forwards audit-log filters', async () => {
    const { service, auditLogs } = makeService();
    const query = { action: 'dealer.approved' };
    await service.auditLogsSearch(query);
    expect(auditLogs.search).toHaveBeenCalledWith(query);
  });
});
