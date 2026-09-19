import { apiClient } from './client'
import type { DealerProfile } from './dealer.types'

export async function getMyDealerProfile(signal?: AbortSignal): Promise<DealerProfile> {
  const { data } = await apiClient.get<DealerProfile>('/dealer-profiles/me', { signal })
  return data
}
