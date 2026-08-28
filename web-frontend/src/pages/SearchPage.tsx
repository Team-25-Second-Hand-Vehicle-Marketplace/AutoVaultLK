import { useEffect, useState } from 'react'
import { useVehicleSearch } from '../hooks/useVehicleSearch'
import { FilterSidebar } from '../components/search/FilterSidebar'
import { SearchToolbar } from '../components/search/SearchToolbar'
import { VehicleCard } from '../components/search/VehicleCard'
import { VehicleCardSkeleton } from '../components/search/VehicleCardSkeleton'
import { EmptyState } from '../components/search/EmptyState'
import { RelaxationNotice } from '../components/search/RelaxationNotice'
import { Pagination } from '../components/search/Pagination'
import { ActiveFilterChips } from '../components/search/ActiveFilterChips'

/** Below this width the sidebar becomes an overlay drawer rather than a column. */
const MOBILE_BREAKPOINT = 1024

export function SearchPage() {
  const {
    draft,
    updateDraft,
    updateDraftMany,
    applyFilters,
    resetDraft,
    hasUnappliedChanges,
    appliedFilters,
    result,
    loading,
    error,
    setSort,
    setPage,
    removeAppliedFilters,
    clearFilters,
  } = useVehicleSearch()

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT)
  // Open by default on desktop (it's a column), closed on mobile (it's an
  // overlay that would otherwise cover the results on first paint).
  const [filtersOpen, setFiltersOpen] = useState(() => window.innerWidth >= MOBILE_BREAKPOINT)

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT
      setIsMobile(mobile)
      // Crossing into desktop should reveal the sidebar again; crossing into
      // mobile should not leave an overlay covering the results.
      setFiltersOpen(!mobile)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Esc closes the mobile drawer, matching every other overlay convention.
  useEffect(() => {
    if (!isMobile || !filtersOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMobile, filtersOpen])

  // Paging while scrolled to the bottom would otherwise land the buyer at the
  // bottom of the next page.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [result?.page])

  const rangeStart = result && result.total > 0 ? (result.page - 1) * result.limit + 1 : 0
  const rangeEnd = result ? Math.min(result.page * result.limit, result.total) : 0

  const applyAndCloseOnMobile = () => {
    applyFilters()
    if (isMobile) setFiltersOpen(false)
  }

  const showSidebar = filtersOpen
  const bodyClass = [
    'search-page__body',
    !showSidebar || isMobile ? 'search-page__body--no-sidebar' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="search-page">
      <SearchToolbar
        sort={appliedFilters.sort ?? 'relevance'}
        onSortChange={setSort}
        isMobile={isMobile}
        onOpenFilters={() => setFiltersOpen(true)}
      />

      <div className={bodyClass}>
        {isMobile && filtersOpen && (
          <div
            className="filter-drawer__backdrop"
            onClick={() => setFiltersOpen(false)}
            aria-hidden="true"
          />
        )}

        {showSidebar && (
          <div className={isMobile ? 'filter-drawer' : undefined}>
            {isMobile && (
              <button
                type="button"
                className="filter-drawer__close"
                onClick={() => setFiltersOpen(false)}
              >
                Close filters
              </button>
            )}
            <FilterSidebar
              filters={draft}
              facets={result?.facets}
              onUpdate={updateDraft}
              onUpdateMany={updateDraftMany}
              onApply={applyAndCloseOnMobile}
              onReset={resetDraft}
              hasUnappliedChanges={hasUnappliedChanges}
            />
          </div>
        )}

        <main className="search-results">
          <ActiveFilterChips
            appliedFilters={appliedFilters}
            onRemove={removeAppliedFilters}
            onClearAll={clearFilters}
          />

          {/* Announced to screen readers so result counts aren't visual-only. */}
          <div className="result-count" role="status" aria-live="polite">
            {loading
              ? 'Searching…'
              : result
                ? result.total > 0
                  ? `Showing ${rangeStart}-${rangeEnd} of ${result.total} vehicles`
                  : 'No vehicles found'
                : ''}
          </div>

          {result?.relaxation && <RelaxationNotice relaxation={result.relaxation} />}

          {error && (
            <div className="search-error" role="alert">
              {error}
            </div>
          )}

          {/* Skeletons replace the grid while loading rather than sitting
              beside stale results, which previously made it ambiguous whether
              the listed cards matched the filters just applied. */}
          {loading && (
            <div className="vehicle-grid" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <VehicleCardSkeleton key={i} />
              ))}
            </div>
          )}

          {!loading && result && result.items.length === 0 && (
            <EmptyState relaxation={result.relaxation} onClearFilters={clearFilters} />
          )}

          {!loading && result && result.items.length > 0 && (
            <div className="vehicle-grid">
              {result.items.map((item) => (
                <VehicleCard key={item.id} result={item} />
              ))}
            </div>
          )}

          {!loading && result && (
            <Pagination page={result.page} totalPages={result.totalPages} onChange={setPage} />
          )}
        </main>
      </div>
    </div>
  )
}
