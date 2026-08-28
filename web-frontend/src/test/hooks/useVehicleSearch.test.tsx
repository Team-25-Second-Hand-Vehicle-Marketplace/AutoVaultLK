import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { useVehicleSearch } from '../../hooks/useVehicleSearch'
import { filterSearch, nlSearch } from '../../api/search.api'
import type { FilterSearchResponse } from '../../api/search.types'

vi.mock('../../api/search.api', () => ({
  filterSearch: vi.fn(),
  nlSearch: vi.fn(),
}))

const emptyResponse: FilterSearchResponse = {
  items: [],
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  appliedFilters: {},
}

function wrapper(initialEntry: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
  )
}

describe('useVehicleSearch', () => {
  beforeEach(() => {
    vi.mocked(filterSearch).mockReset()
    vi.mocked(nlSearch).mockReset()
  })

  it('parses array, number, and boolean filters out of the URL on mount', async () => {
    vi.mocked(filterSearch).mockResolvedValue(emptyResponse)

    const { result } = renderHook(() => useVehicleSearch(), {
      wrapper: wrapper('/search?make=Toyota,Honda&minPrice=500000&isNegotiable=true'),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.appliedFilters.make).toEqual(['Toyota', 'Honda'])
    expect(result.current.appliedFilters.minPrice).toBe(500000)
    expect(result.current.appliedFilters.isNegotiable).toBe(true)
  })

  it('calls filterSearch for structured filters and stores the result', async () => {
    vi.mocked(filterSearch).mockResolvedValue({ ...emptyResponse, total: 3 })

    const { result } = renderHook(() => useVehicleSearch(), {
      wrapper: wrapper('/search?make=Toyota'),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(filterSearch).toHaveBeenCalled()
    expect(nlSearch).not.toHaveBeenCalled()
    expect(result.current.result?.total).toBe(3)
    expect(result.current.error).toBeNull()
  })

  it('calls nlSearch when a free-text q is present', async () => {
    vi.mocked(nlSearch).mockResolvedValue({
      ...emptyResponse,
      parse: {
        confidence: 0.9,
        needsGroqFallback: false,
        usedGroqFallback: false,
        usedSemanticRanking: false,
        usedTrigramFallback: false,
        unresolvedTokens: [],
        semanticText: '',
      },
    })

    const { result } = renderHook(() => useVehicleSearch(), {
      wrapper: wrapper('/search?q=cheap+toyota'),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(nlSearch).toHaveBeenCalled()
    expect(filterSearch).not.toHaveBeenCalled()
  })

  it('surfaces a friendly error message when the search request fails', async () => {
    vi.mocked(filterSearch).mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useVehicleSearch(), {
      wrapper: wrapper('/search'),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeTruthy()
    expect(result.current.result).toBeNull()
  })

  it('updateDraft stages a change without triggering a new search', async () => {
    vi.mocked(filterSearch).mockResolvedValue(emptyResponse)

    const { result } = renderHook(() => useVehicleSearch(), {
      wrapper: wrapper('/search'),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    const callsBefore = vi.mocked(filterSearch).mock.calls.length

    act(() => {
      result.current.updateDraft('minPrice', 100000)
    })

    expect(result.current.draft.minPrice).toBe(100000)
    expect(result.current.hasUnappliedChanges).toBe(true)
    expect(vi.mocked(filterSearch).mock.calls.length).toBe(callsBefore)
  })

  it('applyFilters pushes the draft to the URL and triggers a search', async () => {
    vi.mocked(filterSearch).mockResolvedValue(emptyResponse)

    const { result } = renderHook(() => useVehicleSearch(), {
      wrapper: wrapper('/search'),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.updateDraft('minPrice', 250000)
    })
    act(() => {
      result.current.applyFilters()
    })

    await waitFor(() => expect(result.current.appliedFilters.minPrice).toBe(250000))
    expect(result.current.hasUnappliedChanges).toBe(false)
  })

  it('resetDraft reverts unapplied edits back to the applied filters', async () => {
    vi.mocked(filterSearch).mockResolvedValue(emptyResponse)

    const { result } = renderHook(() => useVehicleSearch(), {
      wrapper: wrapper('/search?minPrice=100000'),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.updateDraft('minPrice', 999999)
    })
    expect(result.current.hasUnappliedChanges).toBe(true)

    act(() => {
      result.current.resetDraft()
    })

    expect(result.current.draft.minPrice).toBe(100000)
    expect(result.current.hasUnappliedChanges).toBe(false)
  })

  it('removeAppliedFilters clears both ends of a range filter in one call', async () => {
    vi.mocked(filterSearch).mockResolvedValue(emptyResponse)

    const { result } = renderHook(() => useVehicleSearch(), {
      wrapper: wrapper('/search?minPrice=100000&maxPrice=500000'),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.removeAppliedFilters(['minPrice', 'maxPrice'])
    })

    await waitFor(() => {
      expect(result.current.appliedFilters.minPrice).toBeUndefined()
      expect(result.current.appliedFilters.maxPrice).toBeUndefined()
    })
  })

  it('clearFilters empties the URL entirely', async () => {
    vi.mocked(filterSearch).mockResolvedValue(emptyResponse)

    const { result } = renderHook(() => useVehicleSearch(), {
      wrapper: wrapper('/search?make=Toyota&minPrice=100000'),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.clearFilters()
    })

    await waitFor(() => {
      expect(result.current.appliedFilters).toEqual({})
    })
  })
})
