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
    businessRegistrationNumber: string
    verificationDocuments: Record<string, unknown>
    /** Presigned URL to view the uploaded business registration certificate, or null if unavailable (e.g. NIC-only individual dealers, or local/demo storage mode). */
    verificationDocumentUrl: string | null
    verifiedBy: string | null
    verifiedAt: string | null
  } | null
}

export interface AdminDealerDetail {
  userId: string
  companyName: string
  contactNumber: string | null
  dealerType: string
  businessRegistrationNumber: string
  businessAddress: string
  city: string
  verificationDocuments: Record<string, unknown>
  verificationDocumentUrl: string | null
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

export interface TimeSeriesPoint {
  date: string
  count: number
}

export interface AdminTimeSeries {
  from: string
  to: string
  listings: TimeSeriesPoint[]
  users: TimeSeriesPoint[]
  uploads: TimeSeriesPoint[]
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

/**
 * A dealer's raw make text that never resolved during ingestion, grouped and
 * scored against the existing dictionary — mirrors admin-service's
 * DictionaryCandidateDto.
 */
export interface DictionaryCandidate {
  /** Normalized (lower-cased, trimmed) — the key used for dismiss/promote. */
  rawValue: string
  /** As the dealer actually typed it, for display. */
  displayValue: string
  occurrences: number
  dealerCount: number
  samples: { make: string | null; model: string | null; description: string | null }[]
  /** Null means nothing in the dictionary is a plausible match — the stronger signal of a genuinely new make. */
  closestMatch: { id: string; canonicalValue: string; score: number } | null
}
