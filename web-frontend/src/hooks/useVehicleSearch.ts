import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { filterSearch } from '../api/search.api'
import type { FilterSearchParams, FilterSearchResponse, SortOption } from '../api/search.types'

const ARRAY_KEYS = [
  'vehicleType', 'make', 'model', 'condition', 'fuelType',
  'transmissionType', 'color', 'locationCity', 'locationDistrict',
] as const

const NUMBER_KEYS = [
  'minPrice', 'maxPrice', 'minYear', 'maxYear',
  'minMileage', 'maxMileage', 'maxOwners', 'page', 'limit',
] as const

const BOOLEAN_KEYS = ['isNegotiable', 'hasRegistrationYear', 'verifiedDealersOnly'] as const

// Filter state lives in the URL, not component state — bookmarkable,
// shareable, and survives the back button. This is the single source of
// truth; the hook only translates between URLSearchParams and the typed
// filter object.
function paramsToFilters(searchParams: URLSearchParams): FilterSearchParams {
  const filters: FilterSearchParams = {}

  for (const key of ARRAY_KEYS) {
    const raw = searchParams.get(key)
    if (raw) (filters as any)[key] = raw.split(',')
  }
  for (const key of NUMBER_KEYS) {
    const raw = searchParams.get(key)
    if (raw !== null && raw !== '') (filters as any)[key] = Number(raw)
  }
  for (const key of BOOLEAN_KEYS) {
    const raw = searchParams.get(key)
    if (raw !== null) (filters as any)[key] = raw === 'true'
  }
  const q = searchParams.get('q')
  if (q) filters.q = q
  const sort = searchParams.get('sort') as SortOption | null
  if (sort) filters.sort = sort

  return filters
}

function filtersToParams(filters: FilterSearchParams): URLSearchParams {
  const params = new URLSearchParams()

  for (const key of ARRAY_KEYS) {
    const value = (filters as any)[key] as string[] | undefined
    if (value && value.length > 0) params.set(key, value.join(','))
  }
  for (const key of NUMBER_KEYS) {
    const value = (filters as any)[key] as number | undefined
    if (value !== undefined) params.set(key, String(value))
  }
  for (const key of BOOLEAN_KEYS) {
    const value = (filters as any)[key] as boolean | undefined
    if (value !== undefined) params.set(key, String(value))
  }
  if (filters.q) params.set('q', filters.q)
  if (filters.sort) params.set('sort', filters.sort)

  return params
}

export function useVehicleSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => paramsToFilters(searchParams), [searchParams])

  const [result, setResult] = useState<FilterSearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    filterSearch({ ...filters, facets: true })
      .then((data) => {
        if (!cancelled) setResult(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? 'Search failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [searchParams])

  const setFilters = useCallback(
    (next: FilterSearchParams) => {
      // Any filter change resets to page 1 — staying on page 4 of a
      // narrower result set makes no sense.
      const withResetPage = { ...next, page: next.page ?? 1 }
      setSearchParams(filtersToParams(withResetPage))
    },
    [setSearchParams],
  )

  const updateFilter = useCallback(
    <K extends keyof FilterSearchParams>(key: K, value: FilterSearchParams[K]) => {
      setFilters({ ...filters, [key]: value })
    },
    [filters, setFilters],
  )

  /**
   * Applies several filter changes in one update. Calling updateFilter twice
   * in a row does NOT work: both calls close over the same `filters` value,
   * so the second overwrites the first. Range inputs set a min and a max
   * together and must use this instead.
   */
  const updateFilters = useCallback(
    (patch: Partial<FilterSearchParams>) => {
      setFilters({ ...filters, ...patch })
    },
    [filters, setFilters],
  )

  const setPage = useCallback(
    (page: number) => {
      setSearchParams(filtersToParams({ ...filters, page }))
    },
    [filters, setSearchParams],
  )

  const clearFilters = useCallback(() => {
    setSearchParams(new URLSearchParams())
  }, [setSearchParams])

  return {
    filters,
    result,
    loading,
    error,
    updateFilter,
    updateFilters,
    setFilters,
    setPage,
    clearFilters,
  }
}
