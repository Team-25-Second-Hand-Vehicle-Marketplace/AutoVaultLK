import { useState } from 'react'
import { useVehicleSearch } from '../hooks/useVehicleSearch'
import { FilterSidebar } from '../components/search/FilterSidebar'
import { SearchToolbar } from '../components/search/SearchToolbar'
import { VehicleCard } from '../components/search/VehicleCard'
import { EmptyState } from '../components/search/EmptyState'
import { RelaxationNotice } from '../components/search/RelaxationNotice'
import { Pagination } from '../components/search/Pagination'
import { ActiveFilterChips } from '../components/search/ActiveFilterChips'

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
    removeAppliedFilter,
    clearFilters,
  } = useVehicleSearch()

  const [filtersOpen, setFiltersOpen] = useState(true)

  const rangeStart = result ? (result.page - 1) * result.limit + 1 : 0
  const rangeEnd = result ? Math.min(result.page * result.limit, result.total) : 0

  return (
    <div className="search-page">
      <SearchToolbar
        q={appliedFilters.q}
        onSubmitKeyword={(q) => removeOrSetKeyword(q)}
        sort={appliedFilters.sort ?? 'relevance'}
        onSortChange={setSort}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
      />

      <div className={filtersOpen ? 'search-page__body' : 'search-page__body search-page__body--no-sidebar'}>
        {filtersOpen && (
          <FilterSidebar
            filters={draft}
            facets={result?.facets}
            onUpdate={updateDraft}
            onUpdateMany={updateDraftMany}
            onApply={applyFilters}
            onReset={resetDraft}
            hasUnappliedChanges={hasUnappliedChanges}
          />
        )}

        <main className="search-results">
          <ActiveFilterChips
            appliedFilters={appliedFilters}
            onRemove={removeAppliedFilter}
            onClearAll={clearFilters}
          />

          {result && (
            <div className="result-count">
              Showing {rangeStart}-{rangeEnd} of {result.total} vehicles
            </div>
          )}

          {result?.relaxation && <RelaxationNotice relaxation={result.relaxation} />}

          {error && <div className="search-error">Something went wrong: {error}</div>}

          {loading && <div className="search-loading">Searching…</div>}

          {!loading && result && result.items.length === 0 && (
            <EmptyState relaxation={result.relaxation} />
          )}

          {!loading && result && result.items.length > 0 && (
            <div className="vehicle-grid">
              {result.items.map((item) => (
                <VehicleCard key={item.id} result={item} />
              ))}
            </div>
          )}

          {result && (
            <Pagination page={result.page} totalPages={result.totalPages} onChange={setPage} />
          )}
        </main>
      </div>
    </div>
  )

  // Keyword search applies immediately (not staged) — pressing Enter in the
  // toolbar should search right away, same as sort/pagination.
  function removeOrSetKeyword(q: string | undefined) {
    if (q === undefined) {
      removeAppliedFilter('q')
    } else {
      updateDraft('q', q)
      // q is applied immediately here rather than waiting for "Apply
      // Filters" — the toolbar's own submit is the user's explicit intent
      // to search, distinct from the sidebar's staged filters.
      applyFilters()
    }
  }
}
