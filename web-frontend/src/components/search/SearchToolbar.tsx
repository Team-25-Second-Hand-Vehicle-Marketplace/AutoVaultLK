import { useState, useEffect } from 'react'
import { SortDropdown } from './SortDropdown'
import type { SortOption } from '../../api/search.types'

interface Props {
  q: string | undefined
  onSubmitKeyword: (q: string | undefined) => void
  sort: SortOption
  onSortChange: (sort: SortOption) => void
  filtersOpen: boolean
  onToggleFilters: () => void
}

/**
 * Top toolbar: free-text keyword search (goes straight to the `q` /
 * tsvector filter, applied immediately on submit — not staged like the
 * sidebar), a Filters toggle for collapsing the sidebar on narrow screens,
 * and sort. Matches the design's top row above the results grid.
 */
export function SearchToolbar({
  q,
  onSubmitKeyword,
  sort,
  onSortChange,
  filtersOpen,
  onToggleFilters,
}: Props) {
  const [keyword, setKeyword] = useState(q ?? '')

  useEffect(() => setKeyword(q ?? ''), [q])

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
        placeholder="Search by make, model, or keyword…"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />

      <button type="button" className="search-toolbar__filters-btn" onClick={onToggleFilters}>
        {filtersOpen ? 'Hide Filters' : 'Filters'}
      </button>

      <SortDropdown value={sort} onChange={onSortChange} />
    </form>
  )
}
