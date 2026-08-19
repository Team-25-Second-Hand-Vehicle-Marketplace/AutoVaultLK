import { apiClient } from './client'
import type {
  AdminAuditLog,
  AdminDashboard,
  AdminReports,
  AdminUploadJob,
  AdminUserRow,
  AuditLogsQuery,
  DealerVerificationStatus,
  UploadJobStatus,
} from './admin.types'

export async function getDashboard(signal?: AbortSignal): Promise<AdminDashboard> {
  const { data } = await apiClient.get<AdminDashboard>('/admin/dashboard', { signal })
  return data
}

export async function listUsers(
  verificationStatus?: DealerVerificationStatus,
  signal?: AbortSignal,
): Promise<AdminUserRow[]> {
  const { data } = await apiClient.get<AdminUserRow[]>('/admin/users', {
    params: verificationStatus ? { verificationStatus } : undefined,
    signal,
  })
  return data
}

export async function listUploads(
  status?: UploadJobStatus,
  signal?: AbortSignal,
): Promise<AdminUploadJob[]> {
  const { data } = await apiClient.get<AdminUploadJob[]>('/admin/uploads', {
    params: status ? { status } : undefined,
    signal,
  })
  return data
}

export async function getReports(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<AdminReports> {
  const { data } = await apiClient.get<AdminReports>('/admin/reports', {
    params: { from, to },
    signal,
  })
  return data
}

export async function searchAuditLogs(
  query: AuditLogsQuery = {},
  signal?: AbortSignal,
): Promise<AdminAuditLog[]> {
  const { data } = await apiClient.get<AdminAuditLog[]>('/admin/audit-logs', {
    params: query,
    signal,
  })
  return data
}

export async function approveDealer(dealerId: string): Promise<unknown> {
  const { data } = await apiClient.post(`/admin/dealers/${dealerId}/approve`)
  return data
}

export async function rejectDealer(dealerId: string): Promise<unknown> {
  const { data } = await apiClient.post(`/admin/dealers/${dealerId}/reject`)
  return data
}

export async function deactivateUser(userId: string): Promise<unknown> {
  const { data } = await apiClient.post(`/admin/users/${userId}/deactivate`)
  return data
}
