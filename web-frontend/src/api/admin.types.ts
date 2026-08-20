/** Response shapes from admin-service public `/admin/*` routes. */

export interface AdminDashboard {
  listings: { live: number }
  users: { total: number; dealers: number; pendingDealers: number }
  uploads: { byStatus: Record<string, number> }
  notifications: {
    total: number
    sent: number
    failed: number
    deliveryRate: number
  }
  audit: { recentCount: number }
}

export type DealerVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED'

export interface AdminUserRow {
  id: string
  email: string
  name: string
  role: string
  isActive: boolean
  createdAt: string
  dealer: {
    userId: string
    companyName: string
    dealerType: string
    city: string
    verificationStatus: DealerVerificationStatus
    // FR-02.1 evidence: what a Business dealer supplied at registration. An
    // administrator approving from this list needs it in front of them.
    businessRegistrationNumber: string
    verificationDocuments: Record<string, unknown>
    verifiedBy: string | null
    verifiedAt: string | null
  } | null
}

/** Full dealer record behind GET /admin/dealers/:id. */
export interface AdminDealerDetail {
  userId: string
  companyName: string
  contactNumber: string | null
  dealerType: string
  businessRegistrationNumber: string
  businessAddress: string
  city: string
  verificationDocuments: Record<string, unknown>
  verificationStatus: DealerVerificationStatus
  verifiedBy: string | null
  verifiedAt: string | null
  createdAt: string
  user: {
    id: string
    email: string
    name: string
    role: string
    isActive: boolean
    createdAt: string
  } | null
}

export type UploadJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PARTIAL'

export interface AdminUploadJob {
  id: string
  dealerId: string
  fileName: string
  status: UploadJobStatus | string
  totalRecords: number
  validRecords: number
  invalidRecords: number
  createdAt: string
}

export interface AdminReports {
  from: string
  to: string
  listings: Record<string, number>
  uploads: {
    jobs: number
    totalRecords: number
    validRecords: number
    invalidRecords: number
  }
  jobRates: {
    errorRate: number
    partialRate: number
  }
  activeUsers: number
}

export interface AdminAuditLog {
  id: string
  actorId: string | null
  action: string
  entityType: string
  entityId: string | null
  changes: Record<string, unknown>
  ipAddress: string | null
  createdAt: string
}

export interface AuditLogsQuery {
  action?: string
  entityType?: string
  actorId?: string
  from?: string
  to?: string
}
