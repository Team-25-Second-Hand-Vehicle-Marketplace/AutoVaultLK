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

// page/limit/facets/sort are control params that act immediately (sort and
// pagination in the design have no "Apply" step) — never part of the staged
// sidebar draft.
const CONTROL_KEYS = new Set(['page', 'limit', 'facets', 'sort'])

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

/**
 * Staged filters, matching the Figma "Filter Results … Apply Filters"
 * sidebar: sidebar edits accumulate in local `draft` state and only reach
 * the URL (and therefore the API) when applyFilters() runs. Sort and page
 * changes bypass the draft entirely — they act immediately, same as before.
 *
 * `draft` re-syncs from the URL whenever the URL changes for a reason other
 * than the draft's own apply — e.g. a chip removal, "Clear all", or the
 * back/forward button — so the sidebar never goes stale relative to what's
 * actually applied.
 */
export function useVehicleSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const appliedFilters = useMemo(() => paramsToFilters(searchParams), [searchParams])

  const [draft, setDraft] = useState<FilterSearchParams>(appliedFilters)
  const [result, setResult] = useState<FilterSearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync the draft whenever the applied (URL) filters change from
  // outside the sidebar itself — keeps chip removal / Clear all / back
  // button reflected in the sidebar's controls immediately.
  useEffect(() => {
    setDraft(appliedFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    filterSearch({ ...appliedFilters, facets: true })
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

  /** Writes straight to the URL/applied filters — bypasses the draft. */
  const applyToUrl = useCallback(
    (next: FilterSearchParams) => {
      const withResetPage = { ...next, page: next.page ?? 1 }
      setSearchParams(filtersToParams(withResetPage))
    },
    [setSearchParams],
  )

  /** Updates one field in the local draft only — does not trigger a search. */
  const updateDraft = useCallback(
    <K extends keyof FilterSearchParams>(key: K, value: FilterSearchParams[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  /**
   * Updates several draft fields at once. Two updateDraft calls in a row
   * would clobber each other — both close over the same prior draft.
   * Range inputs (min+max together) must use this.
   */
  const updateDraftMany = useCallback((patch: Partial<FilterSearchParams>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }, [])

  /** Pushes the staged draft to the URL — this is what "Apply Filters" calls. */
  const applyFilters = useCallback(() => {
    applyToUrl(draft)
  }, [draft, applyToUrl])

  /** Discards draft edits and reverts the sidebar to the last applied state. */
  const resetDraft = useCallback(() => {
    setDraft(appliedFilters)
  }, [appliedFilters])

  const hasUnappliedChanges = useMemo(() => {
    const draftParams = filtersToParams(draft).toString()
    const appliedParams = filtersToParams(appliedFilters).toString()
    return draftParams !== appliedParams
  }, [draft, appliedFilters])

  // Sort acts immediately — it is a CONTROL_KEY, not a staged sidebar filter.
  const setSort = useCallback(
    (sort: SortOption) => {
      applyToUrl({ ...appliedFilters, sort })
    },
    [appliedFilters, applyToUrl],
  )

  const setPage = useCallback(
    (page: number) => {
      applyToUrl({ ...appliedFilters, page })
    },
    [appliedFilters, applyToUrl],
  )

  /** Removes one applied filter immediately (chip ×) — not a draft edit. */
  const removeAppliedFilter = useCallback(
    (key: string) => {
      if (CONTROL_KEYS.has(key)) return
      applyToUrl({ ...appliedFilters, [key]: undefined })
    },
    [appliedFilters, applyToUrl],
  )

  const clearFilters = useCallback(() => {
    setSearchParams(new URLSearchParams())
  }, [setSearchParams])

  return {
    // Staged — bind sidebar inputs to these.
    draft,
    updateDraft,
    updateDraftMany,
    applyFilters,
    resetDraft,
    hasUnappliedChanges,
    // Applied — bind result rendering, chips, and sort/pagination to these.
    appliedFilters,
    result,
    loading,
    error,
    setSort,
    setPage,
    removeAppliedFilter,
    clearFilters,
  }
}
