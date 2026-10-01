import type { DealerListing } from '../../api/listings.types'

export type ColumnKey = 'vehicle' | 'type' | 'condition' | 'year' | 'price' | 'mileage' | 'status'
export type SortDirection = 'asc' | 'desc'

export interface ColumnSort {
  key: ColumnKey
  direction: SortDirection
}

/** Numbers read best highest-first; text reads best A to Z. */
const NUMERIC_COLUMNS: ReadonlySet<ColumnKey> = new Set(['year', 'price', 'mileage'])

export const firstDirection = (key: ColumnKey): SortDirection =>
  NUMERIC_COLUMNS.has(key) ? 'desc' : 'asc'

/**
 * What a click on a column header does: a new column starts in its natural
 * direction, the same column flips it, and a third click turns column sorting
 * off so the list returns to the "Sort by" order.
 */
export function nextColumnSort(current: ColumnSort | null, key: ColumnKey): ColumnSort | null {
  const first = firstDirection(key)
  if (!current || current.key !== key) return { key, direction: first }
  if (current.direction === first) return { key, direction: first === 'asc' ? 'desc' : 'asc' }
  return null
}

function valueOf(listing: DealerListing, key: ColumnKey): string | number | null {
  switch (key) {
    case 'vehicle':
      return `${listing.make} ${listing.model}`
    case 'type':
      return listing.vehicleType
    case 'condition':
      return listing.condition
    case 'year':
      return listing.manufactureYear
    case 'price':
      return listing.price
    case 'mileage':
      return listing.mileage
    case 'status':
      return listing.status
  }
}

/**
 * The rows in column order, or untouched when no column sort is active. A blank
 * value always sorts to the bottom, in either direction, so a listing with no
 * condition never leads the list just because of which way the arrow points.
 */
export function sortListings(rows: DealerListing[], sort: ColumnSort | null): DealerListing[] {
  if (!sort) return rows
  const sign = sort.direction === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    const x = valueOf(a, sort.key)
    const y = valueOf(b, sort.key)
    if (x === null || x === '') return y === null || y === '' ? 0 : 1
    if (y === null || y === '') return -1

    const order =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), undefined, { sensitivity: 'base' })
    return order * sign
  })
}
