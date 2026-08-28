import { SortDropdown } from './SortDropdown'
import type { SortOption } from '../../api/search.types'

interface Props {
  sort: SortOption
  onSortChange: (sort: SortOption) => void
  /**
   * Whether the sidebar is currently an overlay drawer. On desktop it is a
   * permanent column with nothing to toggle, so the button is not rendered
   * at all there.
   */
  isMobile: boolean
  onOpenFilters: () => void
}

/**
 * Row above the results grid: filters access on mobile, and sort.
 *
 * This used to carry its own free-text search box, duplicating the one in
 * the site header — both submitted the same NL query, so the page showed two
 * identical inputs and it was ambiguous which one was "the" search. The
 * header's is global and present on every route, so that is the one that
 * survived.
 */
export function SearchToolbar({ sort, onSortChange, isMobile, onOpenFilters }: Props) {
  return (
    <div className="search-toolbar">
      {/* Desktop keeps the sidebar permanently open, so a toggle there would
          only ever hide something the user asked to see. On mobile the
          sidebar is an overlay and this is the only way to reach it. */}
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
