import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { filterSearch, nlSearch } from '../api/search.api'
import { toErrorMessage } from '../api/client'
import type {
  FilterSearchParams,
  FilterSearchResponse,
  NlParse,
  SortOption,
  SpecFilter,
} from '../api/search.types'

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
  // Written through an index signature rather than `as any` per assignment:
  // the keys come from the readonly tuples above, so this stays a typed
  // write to a known-shaped object.
  const filters: Record<string, unknown> = {}

  for (const key of ARRAY_KEYS) {
    const raw = searchParams.get(key)
    if (raw) filters[key] = raw.split(',')
  }
  for (const key of NUMBER_KEYS) {
    const raw = searchParams.get(key)
    if (raw !== null && raw !== '') filters[key] = Number(raw)
  }
  for (const key of BOOLEAN_KEYS) {
    const raw = searchParams.get(key)
    if (raw !== null) filters[key] = raw === 'true'
  }

  const q = searchParams.get('q')
  if (q) filters.q = q
  const sort = searchParams.get('sort')
  if (sort) filters.sort = sort as SortOption

  // specs round-trips as the same flat "key:value,key:value" string the
  // backend parses. Without this, every spec filter (body type, seats,
  // drive type…) was silently dropped on reload, on a shared link, and on
  // every back/forward navigation — the sidebar showed them as applied
  // while the query no longer contained them.
  const specs = searchParams.get('specs')
  if (specs) {
    filters.specs = specs
      .split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const separatorIndex = pair.indexOf(':')
        return separatorIndex === -1
          ? null
          : { key: pair.slice(0, separatorIndex), value: pair.slice(separatorIndex + 1) }
      })
      .filter((spec): spec is SpecFilter => spec !== null)
  }

  return filters as FilterSearchParams
}

function filtersToParams(filters: FilterSearchParams): URLSearchParams {
  const params = new URLSearchParams()
  const source = filters as Record<string, unknown>

  for (const key of ARRAY_KEYS) {
    const value = source[key] as string[] | undefined
    if (value && value.length > 0) params.set(key, value.join(','))
  }
  for (const key of NUMBER_KEYS) {
    const value = source[key] as number | undefined
    if (value !== undefined) params.set(key, String(value))
  }
  for (const key of BOOLEAN_KEYS) {
    const value = source[key] as boolean | undefined
    if (value !== undefined) params.set(key, String(value))
  }
  if (filters.specs && filters.specs.length > 0) {
    params.set('specs', filters.specs.map((s) => `${s.key}:${s.value}`).join(','))
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
  const [result, setResult] = useState<(FilterSearchResponse & { parse?: NlParse }) | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync the draft whenever the applied (URL) filters change from
  // outside the sidebar itself — keeps chip removal / Clear all / back
  // button reflected in the sidebar's controls immediately.
  useEffect(() => {
    setDraft(appliedFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Depends on searchParams, not appliedFilters: appliedFilters is a fresh
  // object identity on every render of this hook (useMemo over searchParams),
  // so listing it here would re-fire the search on renders where the actual
  // filters are unchanged. searchParams is the real input — appliedFilters is
  // a pure function of it.
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    // Free-text `q` is the NL path (SAD 4.1.4). Sidebar-only searches stay
    // on /search/filters so structured clicks never go through the parser.
    const request = appliedFilters.q
      ? nlSearch(
          {
            q: appliedFilters.q,
            sort: appliedFilters.sort,
            page: appliedFilters.page,
            limit: appliedFilters.limit,
            facets: true,
          },
          controller.signal,
        )
      : filterSearch({ ...appliedFilters, facets: true }, controller.signal)

    request
      .then((data) => setResult(data))
      .catch((err) => {
        // An aborted request is this effect superseding itself, not a
        // failure — surfacing it would flash an error on every filter change.
        if (axios.isCancel(err)) return
        setError(toErrorMessage(err, 'Search failed'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  /**
   * Writes straight to the URL/applied filters — bypasses the draft.
   *
   * Any change other than paging itself resets to page 1: a buyer on page 5
   * who narrows the filters would otherwise land on page 5 of a much shorter
   * result set, which is usually empty and reads as "your filter found
   * nothing". Callers that mean to change the page pass it explicitly.
   */
  const applyToUrl = useCallback(
    (next: FilterSearchParams, keepPage = false) => {
      setSearchParams(filtersToParams({ ...next, page: keepPage ? (next.page ?? 1) : 1 }))
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

  /** Pushes the staged draft to the URL — this is what "Apply Filters" calls.
   *  Drop a leftover NL `q` so the sidebar path is not overridden by /search/nl. */
  const applyFilters = useCallback(() => {
    const next = { ...draft }
    delete next.q
    applyToUrl(next)
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
      applyToUrl({ ...appliedFilters, page }, true)
    },
    [appliedFilters, applyToUrl],
  )

  /**
   * Removes one or more applied filters immediately (chip ×) — not a draft
   * edit.
   *
   * Takes a list rather than a single key because range chips span two keys
   * (minPrice+maxPrice, minYear+maxYear). Calling a single-key remover twice
   * in a row does NOT work: both calls close over the same `appliedFilters`
   * snapshot, so the second overwrites the first and clears only one half of
   * the range — the bug that left a "LKR 1M – 5M" chip removal with minPrice
   * still applied.
   */
  const removeAppliedFilters = useCallback(
    (keys: string[]) => {
      const removable = keys.filter((key) => !CONTROL_KEYS.has(key))
      if (removable.length === 0) return

      const next = { ...appliedFilters }
      for (const key of removable) {
        delete (next as Record<string, unknown>)[key]
      }
      applyToUrl(next)
    },
    [appliedFilters, applyToUrl],
  )

  /**
   * Applies a free-text query immediately via GET /search/nl.
   *
   * Clears structured sidebar filters: the parser owns those fields, and
   * leaving them in the URL would show chips the NL request does not send.
   * Must not go through updateDraft + applyFilters: applyFilters is memoized
   * on the draft from the current render, so it would publish the state as it
   * was BEFORE the keyword was set — the first Enter press searched without
   * the keyword and only a second press appeared to work.
   */
  const setKeyword = useCallback(
    (q: string | undefined) => {
      const next: FilterSearchParams = {}
      if (appliedFilters.sort) next.sort = appliedFilters.sort
      if (q) next.q = q
      applyToUrl(next)
    },
    [appliedFilters.sort, applyToUrl],
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
    setKeyword,
    removeAppliedFilters,
    clearFilters,
  }
}
