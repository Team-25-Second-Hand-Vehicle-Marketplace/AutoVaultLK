import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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


const CONTROL_KEYS = new Set(['page', 'limit', 'facets', 'sort'])

function paramsToFilters(searchParams: URLSearchParams): FilterSearchParams {

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

function logParseDiagnostics(
  query: string | undefined,
  data: FilterSearchResponse & { parse?: NlParse },
): void {
  if (!import.meta.env.DEV || !data.parse) return

  const { parse } = data
  const strategy =
    [
      parse.usedGroqFallback && 'groq',
      parse.usedSemanticRanking && 'semantic',
      parse.usedTrigramFallback && 'trigram',
    ]
      .filter(Boolean)
      .join(' + ') || 'rules'

  console.groupCollapsed(
    `[nl-search] "${query}" → ${data.total} results · ${strategy} · confidence ${parse.confidence.toFixed(2)}`,
  )
  console.log('applied filters:', data.appliedFilters)
  if (parse.unresolvedTokens.length > 0) console.warn('unresolved:', parse.unresolvedTokens)
  if (parse.semanticText) console.log('semantic text:', parse.semanticText)
  if (data.relaxation) console.warn('relaxed:', data.relaxation.message)
  console.groupEnd()
}

export function useVehicleSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const appliedFilters = useMemo(() => paramsToFilters(searchParams), [searchParams])

  // Sidebar controls render from the applied URL filters. Keep an immediately
  // up-to-date snapshot for event handlers because URL updates are asynchronous.
  const draft = appliedFilters
  const draftRef = useRef(draft)

  useEffect(() => {
    draftRef.current = appliedFilters
  }, [appliedFilters])


  const [search, setSearch] = useState<{
    result: (FilterSearchResponse & { parse?: NlParse }) | null
    loading: boolean
    error: string | null
  }>({ result: null, loading: true, error: null })
  const { result, loading, error } = search


  useEffect(() => {
    const controller = new AbortController()
    let settled = false

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
      .then((data) => {
        settled = true
        if (!controller.signal.aborted) {
          logParseDiagnostics(appliedFilters.q, data)
          setSearch({ result: data, loading: false, error: null })
        }
      })
      .catch((err) => {
        settled = true

        if (axios.isCancel(err) || controller.signal.aborted) return
        setSearch((prev) => ({
          ...prev,
          loading: false,
          error: toErrorMessage(err, 'Search failed'),
        }))
      })

    queueMicrotask(() => {
      if (!settled && !controller.signal.aborted) {
        setSearch((prev) => ({ ...prev, loading: true, error: null }))
      }
    })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])


  const applyToUrl = useCallback(
    (next: FilterSearchParams, keepPage = false) => {
      setSearchParams(filtersToParams({ ...next, page: keepPage ? (next.page ?? 1) : 1 }))
    },
    [setSearchParams],
  )

  /** Updates sidebar filters and immediately runs the existing URL-driven search. */
  const updateDraft = useCallback(
    <K extends keyof FilterSearchParams>(key: K, value: FilterSearchParams[K]) => {
      const next = { ...draftRef.current, [key]: value }
      // Sidebar filters replace a natural-language query, as the previous
      // "Apply Filters" behavior did, so the structured filter endpoint gets
      // every selected value.
      delete next.q
      draftRef.current = next
      applyToUrl(next)
    },
    [applyToUrl],
  )

  const updateDraftMany = useCallback(
    (patch: Partial<FilterSearchParams>) => {
      const next = { ...draftRef.current, ...patch }
      delete next.q
      draftRef.current = next
      applyToUrl(next)
    },
    [applyToUrl],
  )

  // Sort acts immediately - it is a CONTROL_KEY, not a staged sidebar filter.
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
    // Sidebar controls use the applied filters, which update immediately.
    draft,
    updateDraft,
    updateDraftMany,
    // Applied - bind result rendering, chips, and sort/pagination to these.
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
