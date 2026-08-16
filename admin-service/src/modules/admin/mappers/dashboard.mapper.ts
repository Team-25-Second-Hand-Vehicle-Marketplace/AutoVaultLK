export type StatusCountRow = {
  status: string;
  count: string | number;
};

export type DashboardRaw = {
  liveListings: number;
  totalUsers: number;
  dealers: number;
  pendingDealers: number;
  uploadsByStatus: StatusCountRow[];
  notificationTotal: number;
  notificationSent: number;
  notificationFailed: number;
  recentAuditCount: number;
};

export type DashboardDto = {
  listings: { live: number };
  users: { total: number; dealers: number; pendingDealers: number };
  uploads: { byStatus: Record<string, number> };
  notifications: {
    total: number;
    sent: number;
    failed: number;
    deliveryRate: number;
  };
  audit: { recentCount: number };
};

export function mapDashboard(raw: DashboardRaw): DashboardDto {
  const byStatus: Record<string, number> = {};
  for (const row of raw.uploadsByStatus) {
    byStatus[row.status] = Number(row.count);
  }

  const total = Number(raw.notificationTotal);
  const sent = Number(raw.notificationSent);
  const failed = Number(raw.notificationFailed);

  return {
    listings: { live: Number(raw.liveListings) },
    users: {
      total: Number(raw.totalUsers),
      dealers: Number(raw.dealers),
      pendingDealers: Number(raw.pendingDealers),
    },
    uploads: { byStatus },
    notifications: {
      total,
      sent,
      failed,
      deliveryRate: total === 0 ? 0 : Number((sent / total).toFixed(4)),
    },
    audit: { recentCount: Number(raw.recentAuditCount) },
  };
}
