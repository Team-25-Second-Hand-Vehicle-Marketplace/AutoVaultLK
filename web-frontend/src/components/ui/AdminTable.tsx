import type { ReactNode } from 'react'

interface AdminTableProps<T> {
  columns: string[]
  rows: T[]
  loading: boolean
  loadingLabel: string
  emptyLabel: string
  /** Must return a full `<tr key={...}>...</tr>` per row. */
  renderRow: (row: T) => ReactNode
}

/**
 * The loading / table / empty-row shell previously duplicated across
 * AdminUsersPage, AdminUploadsPage, and AdminAuditLogsPage — each page kept
 * its own column count and cell markup, only the surrounding structure was
 * copy-pasted. `columns` supplies both the header row and the colSpan for
 * the empty-state row, so the two can no longer drift out of sync by hand.
 */
export function AdminTable<T>({
  columns,
  rows,
  loading,
  loadingLabel,
  emptyLabel,
  renderRow,
}: AdminTableProps<T>) {
  if (loading) {
    return (
      <p className="admin-muted" role="status">
        {loadingLabel}
      </p>
    )
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="admin-table__empty">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map(renderRow)
          )}
        </tbody>
      </table>
    </div>
  )
}
