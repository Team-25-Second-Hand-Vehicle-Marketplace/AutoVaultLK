import { useState, type FormEvent } from 'react'
import { SortDropdown } from './SortDropdown'
import type { SortOption } from '../../api/search.types'

interface Props {
  keyword: string
  onSubmitKeyword: (keyword: string | undefined) => void
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
export function SearchToolbar({
  keyword,
  onSubmitKeyword,
  sort,
  onSortChange,
  filtersOpen,
  onToggleFilters,
}: Props) {
  // The input is local while typing and only lifts on submit — searching per
  // keystroke would fire an NL parse (and a Groq call) for every character.
  const [draft, setDraft] = useState(keyword)

  // Re-sync when the applied query changes from outside this input: a quick
  // chip, a header search, or the back button. Without this the box keeps
  // showing whatever was last typed here while the results say otherwise.
  //
  // Adjusted during render rather than in an effect. React re-runs this
  // component immediately with the new state before touching the DOM, so the
  // stale value is never painted; an effect would commit the old text first
  // and then correct it, which flickers. This is React's documented pattern
  // for state derived from props.
  const [lastKeyword, setLastKeyword] = useState(keyword)
  if (lastKeyword !== keyword) {
    setLastKeyword(keyword)
    setDraft(keyword)
  }

  const submitSearch = (e: FormEvent) => {
    e.preventDefault()
    const q = draft.trim()
    onSubmitKeyword(q === '' ? undefined : q)
  }

  return (
    <form className="search-toolbar" onSubmit={submitSearch} role="search">
      <input
        type="search"
        className="search-toolbar__input"
        placeholder="Try “Toyata Corrola under 8.5m deisel”…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Search vehicles"
      />

      <button type="button" className="search-toolbar__filters-btn" onClick={onToggleFilters}>
        {filtersOpen ? 'Hide Filters' : 'Filters'}
      </button>

      <SortDropdown value={sort} onChange={onSortChange} />
    </form>
  )
}
