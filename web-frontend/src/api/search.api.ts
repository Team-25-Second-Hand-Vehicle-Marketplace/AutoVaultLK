import { apiClient } from './client'
import type {
  FilterSearchParams,
  FilterSearchResponse,
  MarketplaceStats,
  SearchOptionsResponse,
  VehicleDetail,
} from './search.types'

// Serializes array/object fields into the flat forms the backend's DTO
// expects: comma-joined for plain arrays (@Transform(toArray())), and
// "key:value,key:value" for specs (@Transform(parseSpecs())).
//
// specs was originally sent as specs[0][key]=x&specs[0][value]=y, matching
// a @ValidateNested + @Type(() => SpecFilterDto) field on the backend. That
// combination turned out to be a known-fragile interaction with
// ValidationPipe's whitelist:true — the nested array's own properties got
// rejected as "should not exist" even though qs parsed the bracket syntax
// correctly. The backend DTO now parses a flat string instead, so this
// must match that format exactly.
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

/** Landing-page headline figures. Cached server-side for 5 minutes. */
export async function getMarketplaceStats(signal?: AbortSignal): Promise<MarketplaceStats> {
  const { data } = await apiClient.get<MarketplaceStats>('/marketplace/search/stats', { signal })
  return data
}

/** One listing for the detail page. Throws on 404 (non-existent or not LIVE). */
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
