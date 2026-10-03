import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { AuditLog } from '../../../infrastructure/database/entities/audit-log.entity';
import { AuthUserView } from '../../../infrastructure/database/entities/auth-user.view-entity';
import { DealerProfileView } from '../../../infrastructure/database/entities/dealer-profile.view-entity';
import { NotificationView } from '../../../infrastructure/database/entities/notification.view-entity';
import { RejectedRecordView } from '../../../infrastructure/database/entities/rejected-record.view-entity';
import { UploadJobView } from '../../../infrastructure/database/entities/upload-job.view-entity';
import { VehicleView } from '../../../infrastructure/database/entities/vehicle.view-entity';
import type { DashboardRaw, StatusCountRow } from '../mappers/dashboard.mapper';
import type { DayCountRow, TimeSeriesRaw } from '../mappers/time-series.mapper';

const RECENT_AUDIT_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AdminReadsRepository {
  constructor(
    @InjectRepository(AuthUserView)
    private readonly users: Repository<AuthUserView>,
    @InjectRepository(DealerProfileView)
    private readonly dealers: Repository<DealerProfileView>,
    @InjectRepository(VehicleView)
    private readonly vehicles: Repository<VehicleView>,
    @InjectRepository(UploadJobView)
    private readonly uploads: Repository<UploadJobView>,
    @InjectRepository(NotificationView)
    private readonly notifications: Repository<NotificationView>,
    @InjectRepository(AuditLog)
    private readonly auditLogs: Repository<AuditLog>,
    @InjectRepository(RejectedRecordView)
    private readonly rejections: Repository<RejectedRecordView>,
  ) {}

  async loadDashboardRaw(): Promise<DashboardRaw> {
    const [
      liveListings,
      totalUsers,
      dealers,
      pendingDealers,
      uploadsByStatus,
      notificationRows,
      recentAuditCount,
    ] = await Promise.all([
      this.vehicles.count({ where: { status: 'LIVE' } }),
      this.users.count(),
      this.users.count({ where: { role: 'DEALER' } }),
      this.dealers.count({ where: { verificationStatus: 'PENDING' } }),
      this.countByStatus(this.uploads),
      this.countByStatus(this.notifications),
      this.auditLogs.count({
        where: { createdAt: MoreThanOrEqual(new Date(Date.now() - RECENT_AUDIT_MS)) },
      }),
    ]);

    const notificationCounts = toCountMap(notificationRows);

    return {
      liveListings,
      totalUsers,
      dealers,
      pendingDealers,
      uploadsByStatus,
      notificationTotal: sumCounts(notificationCounts),
      notificationSent: notificationCounts.SENT ?? 0,
      notificationFailed: notificationCounts.FAILED ?? 0,
      recentAuditCount,
    };
  }

  async listUsers(verificationStatus?: string) {
    const users = await this.users.find({ order: { createdAt: 'DESC' } });
    const profiles = await this.dealers.find();
    const byUserId = new Map(profiles.map((profile) => [profile.userId, profile]));

    const items = users.map((user) => {
      const dealer = byUserId.get(user.id);
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        // FR-02.1 requires Business dealers to supply a registration number and
        // upload supporting documents. An administrator approving or rejecting
        // from this list is making exactly that call, so the evidence has to
        // travel with the row - otherwise the decision is taken blind.
        dealer: dealer
          ? {
              userId: dealer.userId,
              companyName: dealer.companyName,
              dealerType: dealer.dealerType,
              city: dealer.city,
              verificationStatus: dealer.verificationStatus,
              businessRegistrationNumber: dealer.businessRegistrationNumber,
              verificationDocuments: dealer.verificationDocuments,
              verifiedBy: dealer.verifiedBy,
              verifiedAt: dealer.verifiedAt,
            }
          : null,
      };
    });

    if (!verificationStatus) return items;
    return items.filter((row) => row.dealer?.verificationStatus === verificationStatus);
  }

  /**
   * Full dealer record for the review screen - FR-02.1/FR-02.2.
   *
   * Returns null rather than throwing so the service layer decides the HTTP
   * shape; the repository has no opinion about 404s.
   */
  async findDealer(userId: string) {
    const dealer = await this.dealers.findOne({ where: { userId } });
    if (!dealer) return null;

    const user = await this.users.findOne({ where: { id: userId } });

    return {
      userId: dealer.userId,
      companyName: dealer.companyName,
      contactNumber: dealer.contactNumber,
      dealerType: dealer.dealerType,
      businessRegistrationNumber: dealer.businessRegistrationNumber,
      businessAddress: dealer.businessAddress,
      city: dealer.city,
      verificationDocuments: dealer.verificationDocuments,
      verificationStatus: dealer.verificationStatus,
      verifiedBy: dealer.verifiedBy,
      verifiedAt: dealer.verifiedAt,
      createdAt: dealer.createdAt,
      user: user
        ? {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
          }
        : null,
    };
  }

  listUploads(status?: string) {
    return this.uploads.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  findUploadJob(id: string): Promise<UploadJobView | null> {
    return this.uploads.findOne({ where: { id } });
  }

  async findRejectionsForJob(
    uploadJobId: string,
    page: number,
    limit: number,
  ): Promise<{ items: RejectedRecordView[]; total: number }> {
    const [items, total] = await this.rejections.findAndCount({
      where: { uploadJobId },
      order: { rowNumber: 'ASC', stage: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
  }

  async loadReports(from: Date, to: Date) {
    const [listingRows, uploadSummary, activeUsers] = await Promise.all([
      this.vehicles
        .createQueryBuilder('v')
        .select('v.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('v.createdAt >= :from AND v.createdAt <= :to', { from, to })
        .groupBy('v.status')
        .getRawMany<StatusCountRow>(),
      this.uploads
        .createQueryBuilder('j')
        .select('COUNT(*)', 'jobCount')
        .addSelect(`SUM(CASE WHEN j.status = 'FAILED' THEN 1 ELSE 0 END)`, 'failedCount')
        .addSelect(`SUM(CASE WHEN j.status = 'PARTIAL' THEN 1 ELSE 0 END)`, 'partialCount')
        .addSelect('COALESCE(SUM(j.totalRecords), 0)', 'totalRecords')
        .addSelect('COALESCE(SUM(j.validRecords), 0)', 'validRecords')
        .addSelect('COALESCE(SUM(j.invalidRecords), 0)', 'invalidRecords')
        .where('j.createdAt >= :from AND j.createdAt <= :to', { from, to })
        .getRawOne<{
          jobCount: string | number;
          failedCount: string | number;
          partialCount: string | number;
          totalRecords: string | number;
          validRecords: string | number;
          invalidRecords: string | number;
        }>(),
      this.users
        .createQueryBuilder('u')
        .where('u.isActive = true')
        .andWhere('u.createdAt >= :from AND u.createdAt <= :to', { from, to })
        .getCount(),
    ]);

    const jobCount = Number(uploadSummary?.jobCount ?? 0);
    const failedCount = Number(uploadSummary?.failedCount ?? 0);
    const partialCount = Number(uploadSummary?.partialCount ?? 0);

    return {
      from,
      to,
      listings: Object.fromEntries(
        listingRows.map((row) => [row.status, Number(row.count)]),
      ) as Record<string, number>,
      uploads: {
        jobs: jobCount,
        totalRecords: Number(uploadSummary?.totalRecords ?? 0),
        validRecords: Number(uploadSummary?.validRecords ?? 0),
        invalidRecords: Number(uploadSummary?.invalidRecords ?? 0),
      },
      jobRates: {
        errorRate: jobCount === 0 ? 0 : Number((failedCount / jobCount).toFixed(4)),
        partialRate: jobCount === 0 ? 0 : Number((partialCount / jobCount).toFixed(4)),
      },
      activeUsers,
    };
  }

  async loadDailySeries(from: Date, to: Date): Promise<TimeSeriesRaw> {
    const [listingRows, userRows, uploadRows] = await Promise.all([
      this.vehicles
        .createQueryBuilder('v')
        .select("DATE_TRUNC('day', v.createdAt)", 'day')
        .addSelect('COUNT(*)', 'count')
        .where('v.createdAt >= :from AND v.createdAt <= :to', { from, to })
        .groupBy("DATE_TRUNC('day', v.createdAt)")
        .orderBy("DATE_TRUNC('day', v.createdAt)", 'ASC')
        .getRawMany<DayCountRow>(),
      this.users
        .createQueryBuilder('u')
        .select("DATE_TRUNC('day', u.createdAt)", 'day')
        .addSelect('COUNT(*)', 'count')
        .where('u.createdAt >= :from AND u.createdAt <= :to', { from, to })
        .groupBy("DATE_TRUNC('day', u.createdAt)")
        .orderBy("DATE_TRUNC('day', u.createdAt)", 'ASC')
        .getRawMany<DayCountRow>(),
      this.uploads
        .createQueryBuilder('j')
        .select("DATE_TRUNC('day', j.createdAt)", 'day')
        .addSelect('COUNT(*)', 'count')
        .where('j.createdAt >= :from AND j.createdAt <= :to', { from, to })
        .groupBy("DATE_TRUNC('day', j.createdAt)")
        .orderBy("DATE_TRUNC('day', j.createdAt)", 'ASC')
        .getRawMany<DayCountRow>(),
    ]);

    return { listingRows, userRows, uploadRows };
  }

  private countByStatus(repo: Repository<{ status: string }>): Promise<StatusCountRow[]> {
    return repo
      .createQueryBuilder('row')
      .select('row.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('row.status')
      .getRawMany<StatusCountRow>();
  }
}

function toCountMap(rows: StatusCountRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) map[row.status] = Number(row.count);
  return map;
}

function sumCounts(map: Record<string, number>): number {
  return Object.values(map).reduce((sum, n) => sum + n, 0);
}
