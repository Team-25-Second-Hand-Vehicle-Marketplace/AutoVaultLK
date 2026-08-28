import { apiClient } from './client'
import type {
  FilterSearchParams,
  FilterSearchResponse,
  MarketplaceStats,
  NlSearchParams,
  NlSearchResponse,
  SearchOptionsResponse,
  VehicleDetail,
} from './search.types'

function toQueryParams(filters: FilterSearchParams): Record<string, string> {
  const params: Record<string, string> = {}

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue

    if (key === 'specs' && Array.isArray(value)) {
      const encoded = value
        .map((spec: { key: string; value: string }) => `${spec.key}:${spec.value}`)
        .join(',')
      if (encoded) params.specs = encoded
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

export async function filterSearch(
  filters: FilterSearchParams,
  signal?: AbortSignal,
): Promise<FilterSearchResponse> {
  const { data } = await apiClient.get<FilterSearchResponse>('/marketplace/search/filters', {
    params: toQueryParams(filters),
    signal,
  })
  return data
}


export async function nlSearch(
  params: NlSearchParams,
  signal?: AbortSignal,
): Promise<NlSearchResponse> {
  const { data } = await apiClient.get<NlSearchResponse>('/marketplace/search/nl', {
    params,
    signal,
  })
  return data
}

/** Landing-page headline figures. Cached server-side for 5 minutes. */
export async function getMarketplaceStats(signal?: AbortSignal): Promise<MarketplaceStats> {
  const { data } = await apiClient.get<MarketplaceStats>('/marketplace/search/stats', { signal })
  return data
}

/** One listing for the detail page. Throws on 404 */
export async function getVehicleById(id: string, signal?: AbortSignal): Promise<VehicleDetail> {
  const { data } = await apiClient.get<VehicleDetail>(`/marketplace/search/vehicles/${id}`, {
    signal,
  })
  return data
}

export async function getSearchOptions(
  vehicleType?: string,
  signal?: AbortSignal,
): Promise<SearchOptionsResponse> {
  const { data } = await apiClient.get<SearchOptionsResponse>('/marketplace/search/options', {
    params: vehicleType ? { vehicleType } : {},
    signal,
  })
  return data
}
