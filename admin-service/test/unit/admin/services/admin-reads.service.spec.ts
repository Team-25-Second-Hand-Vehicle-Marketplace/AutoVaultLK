import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminReadsService } from '../../../../src/modules/admin/services/admin-reads.service';
import { mapDashboard } from '../../../../src/modules/admin/mappers/dashboard.mapper';
import { mapTimeSeries } from '../../../../src/modules/admin/mappers/time-series.mapper';

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
      loadDailySeries: jest.fn().mockResolvedValue({
        listingRows: [{ day: '2026-08-01', count: 2 }],
        userRows: [],
        uploadRows: [],
      }),
      findUploadJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
      findRejectionsForJob: jest.fn().mockResolvedValue({
        items: [{ rowNumber: 1, stage: 'VALIDATE_ROWS', reason: 'bad make', rawData: {}, createdAt: new Date() }],
        total: 1,
      }),
    };
    const auditLogs = { search: jest.fn().mockResolvedValue([]) };
    const documentUrlResolver = { resolve: jest.fn().mockResolvedValue(null) };
    const service = new AdminReadsService(
      reads as never,
      auditLogs as never,
      documentUrlResolver as never,
    );
    return { service, reads, auditLogs, documentUrlResolver };
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

  it('rejects a time-series range where from is after to', () => {
    const { service, reads } = makeService();
    const from = new Date('2026-08-02');
    const to = new Date('2026-08-01');
    expect(() => service.timeSeries(from, to)).toThrow(BadRequestException);
    expect(reads.loadDailySeries).not.toHaveBeenCalled();
  });

  it('fills zero-activity days into the daily series', async () => {
    const { service } = makeService();
    const from = new Date('2026-08-01');
    const to = new Date('2026-08-01');
    const raw = {
      listingRows: [{ day: '2026-08-01', count: 2 }],
      userRows: [],
      uploadRows: [],
    };
    await expect(service.timeSeries(from, to)).resolves.toEqual(mapTimeSeries(raw, from, to));
  });

  it('rejects an upload rejections lookup for a job that does not exist', async () => {
    const { service, reads } = makeService();
    reads.findUploadJob.mockResolvedValue(null);

    await expect(service.uploadRejections('missing-job')).rejects.toThrow(NotFoundException);
    expect(reads.findRejectionsForJob).not.toHaveBeenCalled();
  });

  it('defaults page and limit, then maps the rejected rows', async () => {
    const { service, reads } = makeService();

    const result = await service.uploadRejections('job-1');

    expect(reads.findRejectionsForJob).toHaveBeenCalledWith('job-1', 1, 50);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.items[0]).toMatchObject({ rowNumber: 1, reason: 'bad make' });
  });

  it('forwards an explicit page and limit for upload rejections', async () => {
    const { service, reads } = makeService();

    await service.uploadRejections('job-1', 2, 20);

    expect(reads.findRejectionsForJob).toHaveBeenCalledWith('job-1', 2, 20);
  });

  it('forwards audit-log filters', async () => {
    const { service, auditLogs } = makeService();
    const query = { action: 'dealer.approved' };
    await service.auditLogsSearch(query);
    expect(auditLogs.search).toHaveBeenCalledWith(query);
  });
});
