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
