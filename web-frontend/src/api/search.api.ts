import { apiClient } from './client'
import type { FilterSearchParams, FilterSearchResponse, SearchOptionsResponse } from './search.types'

// Serializes array/object fields into the comma-joined and bracketed forms
// the backend's @Transform(toArray()) and SpecFilterDto parsing expect.
function toQueryParams(filters: FilterSearchParams): Record<string, string> {
  const params: Record<string, string> = {}

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue

    if (key === 'specs' && Array.isArray(value)) {
      value.forEach((spec: { key: string; value: string }, i: number) => {
        params[`specs[${i}][key]`] = spec.key
        params[`specs[${i}][value]`] = spec.value
      })
      continue
    }

    if (Array.isArray(value)) {
      if (value.length > 0) params[key] = value.join(',')
      continue
    }

    params[key] = String(value)
  }

  return params
}

export async function filterSearch(filters: FilterSearchParams): Promise<FilterSearchResponse> {
  const { data } = await apiClient.get<FilterSearchResponse>('/marketplace/search/filters', {
    params: toQueryParams(filters),
  })
  return data
}

export async function getSearchOptions(vehicleType?: string): Promise<SearchOptionsResponse> {
  const { data } = await apiClient.get<SearchOptionsResponse>('/marketplace/search/options', {
    params: vehicleType ? { vehicleType } : {},
  })
  return data
}
