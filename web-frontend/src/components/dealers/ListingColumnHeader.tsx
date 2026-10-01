import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { ColumnKey, ColumnSort } from './listing-sort'

interface Props {
  label: string
  columnKey: ColumnKey
  sort: ColumnSort | null
  onSort: (key: ColumnKey) => void
  className?: string
}

/** A table header that sorts its column when clicked, and says which way it is sorted. */
export function ListingColumnHeader({ label, columnKey, sort, onSort, className }: Props) {
  const active = sort?.key === columnKey ? sort : null
  const ariaSort = active ? (active.direction === 'asc' ? 'ascending' : 'descending') : 'none'

  return (
    <th scope="col" aria-sort={ariaSort} className={className}>
      <button
        type="button"
        className={`listing-sort${active ? ' listing-sort--active' : ''}`}
        onClick={() => onSort(columnKey)}
      >
        {label}
        {active ? (
          active.direction === 'asc' ? (
            <ArrowUp size={13} aria-hidden="true" />
          ) : (
            <ArrowDown size={13} aria-hidden="true" />
          )
        ) : (
          <ChevronsUpDown size={13} aria-hidden="true" />
        )}
      </button>
    </th>
  )
}
