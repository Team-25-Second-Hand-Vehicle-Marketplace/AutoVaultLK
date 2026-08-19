import { SortDropdown } from './SortDropdown'
import type { SortOption } from '../../api/search.types'

interface Props {
  sort: SortOption
  onSortChange: (sort: SortOption) => void
  filtersOpen: boolean
  onToggleFilters: () => void
}

/**
 * Top toolbar: free-text NL search (GET /search/nl on submit — not staged
 * like the sidebar), a Filters toggle for collapsing the sidebar on narrow
 * screens, and sort. Matches the design's top row above the results grid.
 */
export function SearchToolbar({ sort, onSortChange, filtersOpen, onToggleFilters }: Props) {
  return (
    <form
      className="search-toolbar"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmitKeyword(keyword.trim() === '' ? undefined : keyword.trim())
      }}
    >
      <input
        type="search"
        className="search-toolbar__input"
        placeholder="Try “Toyata Corrola under 8.5m deisel”…"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />

      <button type="button" className="search-toolbar__filters-btn" onClick={onToggleFilters}>
        {filtersOpen ? 'Hide Filters' : 'Filters'}
      </button>

      <SortDropdown value={sort} onChange={onSortChange} />
    </div>
  )
}
