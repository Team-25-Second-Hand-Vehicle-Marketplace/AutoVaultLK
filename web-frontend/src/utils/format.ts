/**
 * Previously copy-pasted verbatim into AdminUsersPage, AdminUploadsPage, and
 * AdminAuditLogsPage — moved here so the three copies can't drift.
 */
export function formatDate(value: string): string {
  return new Date(value).toLocaleString('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
