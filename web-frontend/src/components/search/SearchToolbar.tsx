import { SortDropdown } from './SortDropdown'
import type { SortOption } from '../../api/search.types'

interface Props {
  sort: SortOption
  onSortChange: (sort: SortOption) => void

  isMobile: boolean
  onOpenFilters: () => void
}

export function SearchToolbar({ sort, onSortChange, isMobile, onOpenFilters }: Props) {
  return (
    <div className="search-toolbar">

      {isMobile && (
        <button type="button" className="search-toolbar__filters-btn" onClick={onOpenFilters}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          Filters
        </button>
      )}

      <SortDropdown value={sort} onChange={onSortChange} />
    </div>
  )
}
