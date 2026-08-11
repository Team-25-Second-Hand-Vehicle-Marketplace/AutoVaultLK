import { useVehicleSearch } from '../hooks/useVehicleSearch'
import { FilterSidebar } from '../components/search/FilterSidebar'
import { VehicleCard } from '../components/search/VehicleCard'
import { EmptyState } from '../components/search/EmptyState'
import { RelaxationNotice } from '../components/search/RelaxationNotice'
import { SortDropdown } from '../components/search/SortDropdown'
import { Pagination } from '../components/search/Pagination'
import { ActiveFilterChips } from '../components/search/ActiveFilterChips'
import type { SortOption } from '../api/search.types'

export function SearchPage() {
  const {
    filters,
    result,
    loading,
    error,
    updateFilter,
    updateFilters,
    setFilters,
    setPage,
    clearFilters,
  } = useVehicleSearch()

  const removeFilter = (key: string) => {
    setFilters({ ...filters, [key]: undefined })
  }

  return (
    <div className="search-page">
      <FilterSidebar
        filters={filters}
        facets={result?.facets}
        onUpdate={updateFilter}
        onUpdateMany={updateFilters}
      />

      <main className="search-results">
        <div className="search-results__header">
          <ActiveFilterChips
            appliedFilters={result?.appliedFilters ?? {}}
            onRemove={removeFilter}
            onClearAll={clearFilters}
          />
          <div className="search-results__controls">
            {result && <span className="result-count">{result.total} vehicles found</span>}
            <SortDropdown
              value={filters.sort ?? 'relevance'}
              onChange={(v: SortOption) => updateFilter('sort', v)}
            />
          </div>
        </div>

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
  )
}
