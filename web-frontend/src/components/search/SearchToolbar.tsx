import { SortDropdown } from './SortDropdown'
import type { SortOption } from '../../api/search.types'

interface Props {
  sort: SortOption
  onSortChange: (sort: SortOption) => void
  filtersOpen: boolean
  onToggleFilters: () => void
}

/**
 * Top toolbar above the results grid: the sidebar toggle on the left, sort on
 * the right.
 *
 * The keyword field that used to sit here has been removed — the header
 * carries a full-width search box on every page, and two identical inputs
 * stacked within ~40px of each other made it ambiguous which one was live.
 * The header field owns keyword entry now; it navigates to /search?q=… so the
 * `q` filter still reaches this page exactly as before.
 *
 * No longer a <form>: with the input gone there is nothing to submit, and a
 * form wrapper would let a stray Enter reload the page.
 */
export function SearchToolbar({ sort, onSortChange, filtersOpen, onToggleFilters }: Props) {
  return (
    <div className="search-toolbar">
      <button type="button" className="search-toolbar__filters-btn" onClick={onToggleFilters}>
        {filtersOpen ? 'Hide Filters' : 'Filters'}
      </button>

      <SortDropdown value={sort} onChange={onSortChange} />
    </div>
  )
}
